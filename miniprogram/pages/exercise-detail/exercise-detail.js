'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')
const { BODY_PART_LABELS } = require('../../models/contracts.js')

function estimate1RM(weight,reps){if(!(weight>0)||!(reps>0))return 0;return Math.round(weight*(1+reps/30)*10)/10}

Page({
  data:{exercise:null,stats:{sessions:0,sets:0,bestWeight:0,best1rm:0,volume:0},history:[],months:[],loading:false,error:''},
  onLoad(options){this.exerciseId=options.id||''},
  onShow(){if(!auth.isLoggedIn()){wx.reLaunch({url:'/pages/login/login'});return}this.load()},
  async onPullDownRefresh(){await this.load();wx.stopPullDownRefresh()},
  async load(){
    if(!this.exerciseId){this.setData({error:'缺少动作 ID'});return}
    this.setData({loading:true,error:''})
    try{
      const [exercises,backup]=await Promise.all([data.listExercises(),data.exportBackup()]),exercise=exercises.find((e)=>e.id===this.exerciseId)
      if(!exercise)throw new Error('动作不存在或已删除')
      const d=backup.data||{},allSets=(d.sets||[]).filter((s)=>s.exerciseId===this.exerciseId),completedIds=new Set((d.sessions||[]).filter((s)=>s.status==='completed').map((s)=>s.id)),sets=allSets.filter((s)=>completedIds.has(s.sessionId)).sort((a,b)=>b.date.localeCompare(a.date)||b.setNumber-a.setNumber),sessionIds=new Set(sets.map((s)=>s.sessionId)),volume=Math.round(sets.reduce((n,s)=>s.weight>0?n+s.weight*s.reps:n,0)),bestWeight=sets.reduce((n,s)=>s.weight>n?s.weight:n,0),best1rm=sets.reduce((n,s)=>Math.max(n,estimate1RM(s.weight,s.reps)),0),byMonth={}
      sets.forEach((s)=>{const key=s.date.slice(0,7),m=byMonth[key]||(byMonth[key]={key,sets:0,volume:0,best:0});m.sets++;if(s.weight>0)m.volume+=s.weight*s.reps;m.best=Math.max(m.best,estimate1RM(s.weight,s.reps))})
      const months=Object.values(byMonth).sort((a,b)=>b.key.localeCompare(a.key)).slice(0,12).map((m)=>Object.assign(m,{volume:Math.round(m.volume),bar:Math.max(6,Math.round(m.best/(best1rm||1)*100))}))
      this.setData({exercise:Object.assign({},exercise,{partLabel:BODY_PART_LABELS[exercise.bodyPart]||exercise.bodyPart}),stats:{sessions:sessionIds.size,sets:sets.length,bestWeight,best1rm,volume},history:sets.slice(0,40).map((s)=>Object.assign({},s,{weightLabel:s.weightType==='bodyweight'?'自重':`${s.weight} kg`,oneRM:estimate1RM(s.weight,s.reps)})),months})
    }catch(e){this.setData({error:e.message||'加载失败'})}finally{this.setData({loading:false})}
  }
})
