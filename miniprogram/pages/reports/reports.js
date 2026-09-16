'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')
const { BODY_PART_LABELS } = require('../../models/contracts.js')

function monthNow(){return new Date().toISOString().slice(0,7)}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:0}
function volleyballTotals(activities){
  const out={count:0,sets:0,wonSets:0,serveAttempts:0,aces:0,attackAttempts:0,attackPoints:0,blockPoints:0,receptionAttempts:0,receptionPerfect:0,digAttempts:0,digSuccessful:0,setAttempts:0,setSuccessful:0,personalPoints:0}
  activities.filter((a)=>a.sport==='volleyball').forEach((a)=>{const sets=Array.isArray(a.volleyballSets)?a.volleyballSets:[],s=a.volleyballStats||{};out.count++;out.sets+=sets.length;out.wonSets+=sets.filter((set)=>finite(set.ourScore)>finite(set.opponentScore)).length;out.serveAttempts+=finite(s.serve&&s.serve.attempts);out.aces+=finite(s.serve&&s.serve.aces);out.attackAttempts+=finite(s.attack&&s.attack.attempts);out.attackPoints+=finite(s.attack&&s.attack.points);out.blockPoints+=finite(s.block&&s.block.points);out.receptionAttempts+=finite(s.reception&&s.reception.attempts);out.receptionPerfect+=finite(s.reception&&s.reception.perfect);out.digAttempts+=finite(s.dig&&s.dig.attempts);out.digSuccessful+=finite(s.dig&&s.dig.successful);out.setAttempts+=finite(s.set&&s.set.attempts);out.setSuccessful+=finite(s.set&&s.set.successful)});out.personalPoints=out.aces+out.attackPoints+out.blockPoints;return out
}
function reportFor(backup,month){
  const d=backup.data||{},sessions=(d.sessions||[]).filter((s)=>s.status==='completed'&&s.date.startsWith(month)),sessionIds=new Set(sessions.map((s)=>s.id)),sets=(d.sets||[]).filter((s)=>sessionIds.has(s.sessionId)),activities=(d.activitySessions||[]).filter((a)=>a.date.startsWith(month)),rests=(d.dailyStatuses||[]).filter((r)=>r.status==='rest'&&r.date.startsWith(month)),partCounts={}
  sessions.forEach((s)=>(s.bodyParts||[]).forEach((p)=>{partCounts[p]=(partCounts[p]||0)+1}))
  const parts=Object.keys(partCounts).map((p)=>({id:p,label:BODY_PART_LABELS[p]||p,count:partCounts[p]})).sort((a,b)=>b.count-a.count)
  const volume=Math.round(sets.reduce((n,s)=>finite(s.weight)>0&&finite(s.reps)>0?n+finite(s.weight)*finite(s.reps):n,0))
  const sportCount={badminton:0,swimming:0,tennis:0,volleyball:0};activities.forEach((a)=>{if(sportCount[a.sport]!==undefined)sportCount[a.sport]++})
  return{month,label:`${Number(month.slice(5))}月`,sessions:sessions.length,sets:sets.length,volume,activities:activities.length,rests:rests.length,parts,sportCount,volleyball:volleyballTotals(activities),minutes:Math.round(activities.reduce((n,a)=>n+finite(a.durationMin),0))}
}

Page({
  data:{months:[],selected:monthNow(),report:null,year:null,milestones:[],loading:false},
  onShow(){if(!auth.isLoggedIn()){wx.reLaunch({url:'/pages/login/login'});return}this.load()},
  async onPullDownRefresh(){await this.load();wx.stopPullDownRefresh()},
  async load(){this.setData({loading:true});try{const backup=await data.exportBackup();this.backup=backup;const d=backup.data||{},set=new Set([monthNow()]);['sessions','activitySessions','dailyStatuses'].forEach((key)=>(d[key]||[]).forEach((r)=>r.date&&set.add(r.date.slice(0,7))));const months=Array.from(set).sort().reverse().map((m)=>{const r=reportFor(backup,m);return{key:m,label:`${m.slice(0,4)}年${Number(m.slice(5))}月`,summary:`${r.sessions} 次力量 · ${r.activities} 次其他运动`}});this.setData({months});this.applyReport(this.data.selected)}catch(e){wx.showToast({title:e.message||'加载报告失败',icon:'none'})}finally{this.setData({loading:false})}},
  applyReport(month){if(!this.backup)return;const report=reportFor(this.backup,month),d=this.backup.data||{},year=month.slice(0,4),yearSessions=(d.sessions||[]).filter((s)=>s.status==='completed'&&s.date.startsWith(year)),yearActivities=(d.activitySessions||[]).filter((a)=>a.date.startsWith(year)),total=yearSessions.length+yearActivities.length,milestones=[];[1,10,25,50,100].forEach((n)=>{if(total>=n)milestones.push({icon:'🏁',title:`累计 ${n} 次训练`,detail:'已达成'})});if(report.volume>=10000)milestones.push({icon:'🏆',title:'月训练量突破 10 吨',detail:`${report.volume} kg`});this.setData({selected:month,report,year:{label:`我的 ${year}`,sessions:yearSessions.length,activities:yearActivities.length,volleyball:volleyballTotals(yearActivities)},milestones})},
  onMonthChange(e){const i=Number(e.detail.value),item=this.data.months[i];if(item)this.applyReport(item.key)}
})
