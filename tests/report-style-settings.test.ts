import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReportStyleSettingsStore } from '../src/main/report-style-settings'
const dirs:string[]=[]
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})})
it('persists only known presets across restarts and leaves existing preferences intact on invalid input',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hostharbor-report-style-'));dirs.push(dir);const store=new ReportStyleSettingsStore(dir)
 expect(store.get()).toBe('default')
 for(const v of ['aurora','grid','nebula','default']){expect(store.save(v)).toBe(v);expect(new ReportStyleSettingsStore(dir).get()).toBe(v)}
 for(const value of ['https://example.invalid/image.jpg','url(data:text/html,x)',{},null,'__proto__'])expect(()=>store.save(value)).toThrow(expect.objectContaining({code:'INVALID_INPUT'}))
 expect(store.get()).toBe('default');expect(readdirSync(dir)).toEqual(['report-style-settings.json']);expect(JSON.parse(readFileSync(join(dir,'report-style-settings.json'),'utf8'))).toEqual({background:'default'})
 writeFileSync(join(dir,'report-style-settings.json'),JSON.stringify({background:'aurora',arbitrary:'bad'}));expect(()=>store.get()).toThrow(expect.objectContaining({code:'STORAGE_FAILED'}))
})
