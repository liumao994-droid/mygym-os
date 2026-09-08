'use strict'

const auth = require('../../services/auth.js')
const data = require('../../services/data.js')
const { BODY_PARTS, BODY_PART_LABELS } = require('../../models/contracts.js')
const { newClientId } = require('../../utils/id.js')

const WEIGHT_TYPES = [
  { value: 'weight', label: '重量' },
  { value: 'dumbbell', label: '哑铃/只' },
  { value: 'bodyweight', label: '自重' },
  { value: 'assisted', label: '辅助' }
]

function emptyForm() { return { name: '', bodyPart: 'chest', defaultWeightType: 'weight' } }

Page({
  data: {
    exercises: [], visible: [], query: '', filter: '',
    parts: BODY_PARTS.map((id) => ({ id, label: BODY_PART_LABELS[id] })),
    weightTypes: WEIGHT_TYPES, editorOpen: false, editingId: '', form: emptyForm(), busy: false, loading: false
  },
  onShow() {
    if (!auth.isLoggedIn()) { wx.reLaunch({ url: '/pages/login/login' }); return }
    this.load()
  },
  async onPullDownRefresh(){await this.load();wx.stopPullDownRefresh()},
  async load() {
    this.setData({ loading: true })
    try {
      const exercises = (await data.listExercises()).map((e) => Object.assign({}, e, { partLabel: BODY_PART_LABELS[e.bodyPart] || e.bodyPart }))
      this.setData({ exercises }); this.filterList()
    } catch(e){wx.showToast({title:e.message||'加载失败',icon:'none'})} finally{this.setData({loading:false})}
  },
  onSearch(e){this.setData({query:e.detail.value});this.filterList()},
  onFilter(e){const id=e.currentTarget.dataset.id;this.setData({filter:this.data.filter===id?'':id});this.filterList()},
  filterList(){const q=this.data.query.trim().toLowerCase(),f=this.data.filter;this.setData({visible:this.data.exercises.filter((e)=>(!f||e.bodyPart===f)&&(!q||e.name.toLowerCase().includes(q))).sort((a,b)=>a.name.localeCompare(b.name,'zh'))})},
  onCreate(){this.setData({editorOpen:true,editingId:'',form:emptyForm()})},
  onOpen(e){const id=e.currentTarget.dataset.id;if(id)wx.navigateTo({url:`/pages/exercise-detail/exercise-detail?id=${id}`})},
  onEdit(e){const item=this.data.exercises.find((x)=>x.id===e.currentTarget.dataset.id);if(item)this.setData({editorOpen:true,editingId:item.id,form:{name:item.name,bodyPart:item.bodyPart,defaultWeightType:item.defaultWeightType||'weight'}})},
  onClose(){if(!this.data.busy)this.setData({editorOpen:false})},
  onName(e){this.setData({'form.name':e.detail.value})},
  onPart(e){this.setData({'form.bodyPart':e.currentTarget.dataset.id})},
  onType(e){this.setData({'form.defaultWeightType':e.currentTarget.dataset.value})},
  async onSave(){
    const f=this.data.form
    if(!f.name.trim()){wx.showToast({title:'请输入动作名称',icon:'none'});return}
    this.setData({busy:true})
    try{
      const now=Date.now(),payload={name:f.name.trim(),bodyPart:f.bodyPart,defaultWeightType:f.defaultWeightType,equipment:f.defaultWeightType==='bodyweight'?'bodyweight':f.defaultWeightType==='assisted'?'assisted':f.defaultWeightType==='dumbbell'?'dumbbell':'machine',isCustom:1,updatedAt:now}
      if(this.data.editingId)await data.patchExercise(this.data.editingId,payload)
      else await data.createExercise(Object.assign({id:newClientId('exercise'),createdAt:now},payload))
      this.setData({editorOpen:false});await this.load();wx.showToast({title:'已保存',icon:'success'})
    }catch(e){wx.showToast({title:e.message||'保存失败',icon:'none'})}finally{this.setData({busy:false})}
  },
  async onDelete(){
    if(!this.data.editingId)return
    const r=await wx.showModal({title:'删除这个动作？',content:'历史训练仍会保留，动作将不再出现在选择列表。',confirmText:'删除',confirmColor:'#b44747'})
    if(!r.confirm)return
    try{await data.deleteExercise(this.data.editingId);this.setData({editorOpen:false});await this.load()}catch(e){wx.showToast({title:e.message||'删除失败',icon:'none'})}
  },
  noop(){}
})
