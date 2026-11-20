import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { utils } from 'ssh2'
import { AppError } from '../shared/errors'

// Explicit desktop import only; never a generic file/MCP read API.
export async function readPrivateKeyFile(raw:unknown, guard:()=>void|Promise<void>, home=homedir()):Promise<string> {
 await guard()
 if(typeof raw!=='string'||!raw.trim()||raw.length>4096||/[\0\r\n]/.test(raw))throw new AppError('KEY_FILE_READ')
 const input=raw.trim(),path=input.startsWith('~/')||input.startsWith('~\\')?join(home,input.slice(2)):input
 if(!isAbsolute(path))throw new AppError('KEY_FILE_READ')
 let file:Awaited<ReturnType<typeof open>>|undefined
 const buffer=Buffer.alloc(262145)
 try{
  file=await open(path,constants.O_RDONLY|(constants.O_NONBLOCK??0))
  const stat=await file.stat()
  if(!stat.isFile()||stat.size<1||stat.size>262144)throw new AppError('KEY_FILE_READ')
  let size=0
  while(size<buffer.length){const {bytesRead}=await file.read(buffer,size,buffer.length-size,null);if(!bytesRead)break;size+=bytesRead}
  if(size<1||size>262144)throw new AppError('KEY_FILE_READ')
  const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size))
  const parsed=utils.parseKey(text)
  if(parsed instanceof Error){if(!/no passphrase given/i.test(parsed.message))throw new AppError('INVALID_PRIVATE_KEY')}
  else if(!(Array.isArray(parsed)?parsed:[parsed]).some(key=>key.isPrivateKey()))throw new AppError('INVALID_PRIVATE_KEY')
  await guard()
  return text
 }catch(error){if(error instanceof AppError)throw error;throw new AppError('KEY_FILE_READ')}
 finally{buffer.fill(0);await file?.close().catch(()=>{})}
}
