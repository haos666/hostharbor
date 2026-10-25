import { describe,expect,it } from 'vitest'
import { replayDuration,replayText } from '../src/renderer/src/replay'
const chunks=[{seq:0,elapsedMs:5000,stream:'stdout' as const,text:'first\n'},{seq:1,elapsedMs:6000,stream:'stderr' as const,text:'error\n'},{seq:2,elapsedMs:7000,stream:'stdout' as const,text:'last\n'}]
describe('nonexecuting text playback',()=>{
  it('uses first output as time zero, seeks reproducibly, and splits streams',()=>{
    expect(replayDuration(chunks)).toBe(2000)
    expect(replayText(chunks,0,'all').text).toBe('first\n')
    expect(replayText(chunks,1000,'all').text).toBe('first\n[stderr] error\n')
    expect(replayText(chunks,2000,'stdout').text).toBe('first\nlast\n')
    expect(replayText(chunks,2000,'stderr').text).toBe('error\n')
    expect(replayText(chunks,0,'all').text).toBe('first\n')
    const backwards=[chunks[0],chunks[1],{...chunks[2],elapsedMs:5500}]
    expect(replayDuration(backwards)).toBe(1000);expect(replayText(backwards,500,'all').text).toBe('first\n')
  })
  it('handles empty/single output and bounds displayed text without changing recorded chunks',()=>{
    expect(replayDuration([])).toBe(0);expect(replayText([],0,'all').text).toBe('')
    const huge=[{...chunks[0],text:'x'.repeat(1048577)}]
    expect(replayText(huge,0,'all')).toEqual({text:'x'.repeat(1048576),truncated:true})
    expect(huge[0].text.length).toBe(1048577)
  })
})
