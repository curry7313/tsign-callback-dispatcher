/**
 * 回调消息中支持的常用字段路径
 * 用于标签管理（标签键选择）和匹配规则（匹配字段选择）
 */
export const COMMON_FIELDS = [
  { label: '消息类型 (MsgType)', value: 'MsgType' },
  { label: '合同名称 (MsgData.FlowName)', value: 'MsgData.FlowName' },
  { label: '操作类型 (MsgData.Operate)', value: 'MsgData.Operate' },
  { label: '合同状态 (MsgData.FlowCallbackStatus)', value: 'MsgData.FlowCallbackStatus' },
  { label: '合同展示状态 (MsgData.FlowCallbackShowStatus)', value: 'MsgData.FlowCallbackShowStatus' },
  { label: '组织ID (MsgData.OrganizationId)', value: 'MsgData.OrganizationId' },
  { label: '用户数据 (MsgData.UserData)', value: 'MsgData.UserData' },
];
