import { createConnection, createServer, type Socket, type AddressInfo } from 'node:net'
import { Server, utils, type Connection, type ServerChannel } from 'ssh2'

export async function sshFixture(options: { username?: string; password?: string; forwardPort?: number; denyForward?: boolean; port?: number; holdAuth?: boolean; exec?: (command: string, stream: ServerChannel) => void } = {}) {
  const clients = new Set<Connection>(), sockets = new Set<Socket>()
  const users: string[] = [], destinations: string[] = []
  let sessions = 0
  const server = new Server({ hostKeys: [utils.generateKeyPairSync('ecdsa', { bits: 256 }).private] }, (client) => {
    clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client))
    client.on('authentication', (context) => {
      if (context.method === 'password') users.push(context.username)
      if (context.method === 'password' && options.holdAuth) return
      if (context.method === 'password' && context.username === (options.username ?? 'target-user') && context.password === (options.password ?? 'target-secret')) context.accept()
      else context.reject()
    })
    client.on('session', (accept, reject) => { sessions++; if (!options.exec) { reject(); return } const session = accept(); session.on('exec', (acceptExec, _rejectExec, info) => options.exec!(info.command, acceptExec())) })
    client.on('tcpip', (accept, reject, info) => {
      destinations.push(info.destIP)
      if (!options.forwardPort || options.denyForward || info.destIP !== 'target.internal' || info.destPort !== options.forwardPort) { reject(); return }
      const socket = createConnection({ host: '127.0.0.1', port: options.forwardPort })
      sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => reject())
      socket.once('connect', () => { const channel = accept(); channel.on('error', () => socket.destroy()); channel.on('close', () => socket.destroy()); socket.pipe(channel).pipe(socket) })
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve) })
  let closed = false
  const close = async () => { if (closed) return; closed = true; for (const client of clients) client.end(); for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())) }
  return { port: (server.address() as AddressInfo).port, users, destinations, close, get sessions() { return sessions }, get active() { return clients.size + sockets.size } }
}
function read(socket: Socket, count: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0)
    const cleanup = () => { socket.off('data', receive); socket.off('end', end); socket.off('error', end) }
    const end = () => { cleanup(); reject(new Error('Synthetic peer closed')) }
    const receive = (chunk: Buffer) => {
      data = Buffer.concat([data, chunk])
      if (data.length >= count) { socket.pause(); cleanup(); if (data.length > count) socket.unshift(data.subarray(count)); resolve(data.subarray(0, count)) }
    }
    socket.on('data', receive); socket.once('end', end); socket.once('error', end); socket.resume()
  })
}
export async function socksFixture(targetPort: number, options: { auth?: boolean; deny?: boolean; hold?: boolean } = {}) {
  const sockets = new Set<Socket>(), users: string[] = [], destinations: string[] = []
  const own = (socket: Socket) => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); return socket }
  const server = createServer((incoming) => {
    const socket = own(incoming)
    if (options.hold) { socket.resume(); return }
    void (async () => {
      const hello = await read(socket, 2), methods = await read(socket, hello[1])
      const method = options.auth ? 2 : 0
      if (!methods.includes(method)) { socket.end(Buffer.from([5, 255])); return }
      socket.write(Buffer.from([5, method]))
      if (options.auth) {
        const auth = await read(socket, 2), username = (await read(socket, auth[1])).toString()
        const length = (await read(socket, 1))[0], password = (await read(socket, length)).toString()
        users.push(username)
        const valid = username === 'proxy-user' && password === 'proxy-secret'
        socket.write(Buffer.from([1, valid ? 0 : 1])); if (!valid) { socket.end(); return }
      }
      const request = await read(socket, 4)
      let host: string
      if (request[3] === 3) host = (await read(socket, (await read(socket, 1))[0])).toString()
      else if (request[3] === 1) host = [...await read(socket, 4)].join('.')
      else { socket.destroy(); return }
      const port = (await read(socket, 2)).readUInt16BE()
      destinations.push(host)
      if (options.deny || request[1] !== 1 || host !== 'target.internal' || port !== targetPort) { socket.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])); return }
      const remote = own(createConnection({ host: '127.0.0.1', port: targetPort }))
      remote.once('error', () => socket.destroy())
      remote.once('connect', () => { socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])); remote.pipe(socket).pipe(remote); socket.resume() })
      socket.once('close', () => remote.destroy()); remote.once('close', () => socket.destroy())
    })().catch(() => socket.destroy())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  let closed = false
  return { port: (server.address() as AddressInfo).port, users, destinations, get active() { return sockets.size }, close: async () => { if (closed) return; closed = true; for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())) } }
}
