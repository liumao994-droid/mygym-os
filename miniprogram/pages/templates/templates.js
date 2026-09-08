'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')
const strength = require('../../services/strength.js')
const { BODY_PARTS, BODY_PART_LABELS } = require('../../models/contracts.js')
const { newClientId } = require('../../utils/id.js')

function emptyForm(){return{name:'',bodyParts:[],items:[]}}
function decorateTemplate(t){
  return Object.assign({},t,{partLabel:(t.bodyParts||[]).map((p)=>BODY_PART_LABELS[p]||p).join(' + '),setCount:(t.items||[]).reduce((n,i)=>n+(i.sets||[]).reduce((m,s)=>m+Number(s.count||0),0),0)})
}

Page({
  data:{templates:[],exercises:[],parts:BODY_PARTS.map((id)=>({id,label:BODY_PART_LABELS[id]})),editorOpen:false,editingId:'',form:emptyForm(),busy:false,loading:false},
  onShow(){if(!auth.isLoggedIn()){wx.reLaunch({url:'/pages/login/login'});return}this.load()},
  async onPullDownRefresh(){await this.load();wx.stopPullDownRefresh()},
  async load(){this.setData({loading:true});try{const [templates,exercises]=await Promise.all([data.listTemplates(),data.listExercises()]);this.setData({templates:templates.map(decorateTemplate),exercises})}catch(e){wx.showToast({title:e.message||'加载失败',icon:'none'})}finally{this.setData({loading:false})}},
  onCreate(){this.setData({editorOpen:true,editingId:'',form:emptyForm(),parts:this.data.parts.map((p)=>Object.assign({},p,{selected:false}))})},
  onEdit(e){const t=this.data.templates.find((x)=>x.id===e.currentTarget.dataset.id);if(!t)return;const names=new Map(this.data.exercises.map((x)=>[x.id,x.name])),selected=t.bodyParts||[];this.setData({editorOpen:true,editingId:t.id,parts:this.data.parts.map((p)=>Object.assign({},p,{selected:selected.includes(p.id)})),form:{name:t.name,bodyParts:selected.slice(),items:(t.items||[]).map((i)=>{const s=(i.sets||[])[0]||{};return{exerciseId:i.exerciseId,name:names.get(i.exerciseId)||'已删除动作',weight:String(Math.abs(Number(s.weight||0))),reps:String(s.reps||10),count:String(s.count||3),weightType:s.weightType||'weight'}})}})},
  onClose(){if(!this.data.busy)this.setData({editorOpen:false})},
  onName(e){this.setData({'form.name':e.detail.value})},
  onPart(e){const id=e.currentTarget.dataset.id,parts=this.data.form.bodyParts.slice(),i=parts.indexOf(id);if(i>=0)parts.splice(i,1);else parts.push(id);this.setData({'form.bodyParts':parts,parts:this.data.parts.map((p)=>Object.assign({},p,{selected:parts.includes(p.id)}))})},
  onAddExercise(e){const id=e.currentTarget.dataset.id;if(this.data.form.items.some((i)=>i.exerciseId===id))return;const ex=this.data.exercises.find((x)=>x.id===id);const items=this.data.form.items.concat([{exerciseId:id,name:ex.name,weight:ex.defaultWeightType==='bodyweight'?'':'20',reps:'10',count:'3',weightType:ex.defaultWeightType||'weight'}]);this.setData({'form.items':items})},
  onRemoveItem(e){const index=Number(e.currentTarget.dataset.index);const items=this.data.form.items.slice();items.splice(index,1);this.setData({'form.items':items})},
  onItemField(e){const index=Number(e.currentTarget.dataset.index),field=e.currentTarget.dataset.field;this.setData({[`form.items[${index}].${field}`]:e.detail.value})},
  async onSave(){
    const f=this.data.form;if(!f.name.trim()){wx.showToast({title:'请输入模板名称',icon:'none'});return}if(!f.items.length){wx.showToast({title:'至少添加一个动作',icon:'none'});return}
    const now=Date.now(),payload={name:f.name.trim(),bodyParts:f.bodyParts.length?f.bodyParts:['chest'],items:f.items.map((i)=>({exerciseId:i.exerciseId,sets:[{weight:i.weightType==='assisted'?-Math.abs(Number(i.weight)||0):Number(i.weight)||0,reps:Math.max(1,Number(i.reps)||1),count:Math.max(1,Number(i.count)||1),weightType:i.weightType}]})),updatedAt:now}
    this.setData({busy:true});try{if(this.data.editingId)await data.patchTemplate(this.data.editingId,payload);else await data.createTemplate(Object.assign({id:newClientId('template'),createdAt:now},payload));this.setData({editorOpen:false});await this.load();wx.showToast({title:'模板已保存',icon:'success'})}catch(e){wx.showToast({title:e.message||'保存失败',icon:'none'})}finally{this.setData({busy:false})}
  },
  async onDelete(e){const id=e.currentTarget.dataset.id,r=await wx.showModal({title:'删除这个模板？',confirmText:'删除',confirmColor:'#b44747'});if(!r.confirm)return;try{await data.deleteTemplate(id);await this.load()}catch(err){wx.showToast({title:err.message||'删除失败',icon:'none'})}},
  async onStart(e){if(this.data.busy)return;const t=this.data.templates.find((x)=>x.id===e.currentTarget.dataset.id);if(!t)return;this.setData({busy:true});try{const s=await strength.startFromTemplate(t);wx.navigateTo({url:`/pages/workout/workout?id=${s.id}`})}catch(err){wx.showToast({title:err.message||'开始失败',icon:'none'})}finally{this.setData({busy:false})}},
  noop(){}
})
