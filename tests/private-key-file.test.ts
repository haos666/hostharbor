import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { utils } from 'ssh2'
import { readPrivateKeyFile } from '../src/main/private-key-file'
import { AppError } from '../src/shared/errors'

const directories:string[]=[]
async function fixture(){const home=await mkdtemp(join(tmpdir(),'hostharbor-key-import-'));directories.push(home);await mkdir(join(home,'.ssh'));return home}
const key=utils.generateKeyPairSync('ecdsa',{bits:256})
afterEach(async()=>{await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})))})
describe('explicit desktop private key path import',()=>{
 it('imports hidden home paths and absolute paths with spaces',async()=>{const home=await fixture();const path=join(home,'.ssh','test key');await writeFile(path,key.private,{mode:0o600});expect((await readPrivateKeyFile('~/.ssh/test key',()=>{},home))===key.private).toBe(true);expect((await readPrivateKeyFile(path,()=>{}))===key.private).toBe(true)})
 it('accepts encrypted keys before the passphrase is entered',async()=>{const home=await fixture();const encrypted=utils.generateKeyPairSync('ecdsa',{bits:256,cipher:'aes256-cbc',passphrase:'synthetic-passphrase',rounds:16}).private;const path=join(home,'.ssh','encrypted');await writeFile(path,encrypted);expect((await readPrivateKeyFile(path,()=>{}))===encrypted).toBe(true)})
 it('rejects public keys and ordinary text',async()=>{const home=await fixture();for(const value of [key.public,'ordinary text']){const path=join(home,'.ssh','invalid');await writeFile(path,value);await expect(readPrivateKeyFile(path,()=>{})).rejects.toMatchObject({code:'INVALID_PRIVATE_KEY'})}})
 it('rejects invalid, missing, oversized and non-file paths',async()=>{const home=await fixture();const large=join(home,'large');await writeFile(large,Buffer.alloc(262145));for(const path of ['',123,'relative/key','/invalid\0key','/invalid\nkey',join(home,'missing'),join(home,'.ssh'),large])await expect(readPrivateKeyFile(path,()=>{})).rejects.toMatchObject({code:'KEY_FILE_READ'})})
 it('checks lock state before reading and before returning',async()=>{await expect(readPrivateKeyFile('/missing',()=>{throw new AppError('VAULT_LOCKED')})).rejects.toMatchObject({code:'VAULT_LOCKED'});const home=await fixture(),path=join(home,'key');await writeFile(path,key.private);let count=0;await expect(readPrivateKeyFile(path,()=>{if(++count===2)throw new AppError('VAULT_LOCKED')})).rejects.toMatchObject({code:'VAULT_LOCKED'});expect(count).toBe(2)})
})
