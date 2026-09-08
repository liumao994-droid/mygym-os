'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')
const ai = require('../../services/ai.js')
const { BODY_PART_LABELS } = require('../../models/contracts.js')

function monthNow(){return new Date().toISOString().slice(0,7)}
function reportFor(backup,month){
  const d=backup.data||{},sessions=(d.sessions||[]).filter((s)=>s.status==='completed'&&s.date.startsWith(month)),sessionIds=new Set(sessions.map((s)=>s.id)),sets=(d.sets||[]).filter((s)=>sessionIds.has(s.sessionId)),activities=(d.activitySessions||[]).filter((a)=>a.date.startsWith(month)),rests=(d.dailyStatuses||[]).filter((r)=>r.status==='rest'&&r.date.startsWith(month)),partCounts={}
  sessions.forEach((s)=>(s.bodyParts||[]).forEach((p)=>{partCounts[p]=(partCounts[p]||0)+1}))
  const parts=Object.keys(partCounts).map((p)=>({id:p,label:BODY_PART_LABELS[p]||p,count:partCounts[p]})).sort((a,b)=>b.count-a.count)
  const volume=Math.round(sets.reduce((n,s)=>s.weight>0&&s.reps>0?n+s.weight*s.reps:n,0))
  const sportCount={badminton:0,swimming:0,tennis:0};activities.forEach((a)=>{if(sportCount[a.sport]!==undefined)sportCount[a.sport]++})
  return{month,label:`${Number(month.slice(5))}月`,sessions:sessions.length,sets:sets.length,volume,activities:activities.length,rests:rests.length,parts,sportCount,minutes:activities.reduce((n,a)=>n+Number(a.durationMin||0),0)}
}

Page({
  data:{months:[],selected:monthNow(),report:null,year:null,milestones:[],quota:null,aiText:'',loading:false,busy:false},
  onShow(){if(!auth.isLoggedIn()){wx.reLaunch({url:'/pages/login/login'});return}this.load()},
  async onPullDownRefresh(){await this.load();wx.stopPullDownRefresh()},
  async load(){this.setData({loading:true});try{const [backup,quota]=await Promise.all([data.exportBackup(),ai.quota().catch(()=>null)]);this.backup=backup;const d=backup.data||{},set=new Set([monthNow()]);['sessions','activitySessions','dailyStatuses'].forEach((key)=>(d[key]||[]).forEach((r)=>r.date&&set.add(r.date.slice(0,7))));const months=Array.from(set).sort().reverse().map((m)=>{const r=reportFor(backup,m);return{key:m,label:`${m.slice(0,4)}年${Number(m.slice(5))}月`,summary:`${r.sessions} 次力量 · ${r.activities} 次其他运动`}});this.setData({months,quota});this.applyReport(this.data.selected)}catch(e){wx.showToast({title:e.message||'加载报告失败',icon:'none'})}finally{this.setData({loading:false})}},
  applyReport(month){if(!this.backup)return;const report=reportFor(this.backup,month),d=this.backup.data||{},year=month.slice(0,4),yearSessions=(d.sessions||[]).filter((s)=>s.status==='completed'&&s.date.startsWith(year)),yearActivities=(d.activitySessions||[]).filter((a)=>a.date.startsWith(year)),total=yearSessions.length+yearActivities.length,milestones=[];[1,10,25,50,100].forEach((n)=>{if(total>=n)milestones.push({icon:'🏁',title:`累计 ${n} 次训练`,detail:'已达成'})});if(report.volume>=10000)milestones.push({icon:'🏆',title:'月训练量突破 10 吨',detail:`${report.volume} kg`});this.setData({selected:month,report,year:{label:`我的 ${year}`,sessions:yearSessions.length,activities:yearActivities.length},milestones,aiText:''})},
  onMonthChange(e){const i=Number(e.detail.value),item=this.data.months[i];if(item)this.applyReport(item.key)},
  async onAI(){if(this.data.busy||!this.data.report)return;this.setData({busy:true,aiText:''});try{const r=this.data.report,out=await ai.trainingSummary({kind:'month',period:r.month,stats:{strengthSessions:r.sessions,totalSets:r.sets,totalVolumeKg:r.volume,otherActivities:r.activities,activityMinutes:r.minutes,restDays:r.rests,bodyPartDistribution:r.parts,sports:r.sportCount}});this.setData({aiText:out.content,quota:out.quota||this.data.quota})}catch(e){wx.showToast({title:e.message||'AI 分析失败',icon:'none'})}finally{this.setData({busy:false})}}
})
