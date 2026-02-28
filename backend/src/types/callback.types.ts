// 通用回调消息外层结构
export interface TSignCallbackMessage {
  MsgId: string;
  MsgType: string;
  MsgVersion: string;
  MsgData: any;
}

// 加密回调消息结构
export interface EncryptedCallbackMessage {
  encrypt: string;
}

// 合同状态变动回调
export interface FlowStatusChangeData {
  FlowId: string;
  DocumentId: string;
  CallbackType: string;
  FlowName: string;
  FlowDescription: string;
  FlowType: string;
  FlowCallbackStatus: number;
  Unordered: boolean;
  CreateOn: number;
  UpdatedOn: number;
  DeadLine: number;
  UserId: string;
  RecipientId: string;
  Operate: string;
  UserData: string;
  Approvers: ApproverInfo[];
  CallbackUrl: string;
  FlowGroupMessage?: FlowGroupInfo;
}

export interface ApproverInfo {
  UserId: string;
  RecipientId: string;
  ApproverType: number;
  OrganizationName: string;
  Required: boolean;
  ApproverName: string;
  ApproverMobile: string;
  ApproverIdCardType: string;
  ApproverIdCardNumber: string;
  ApproveCallbackStatus: number;
  ApproveMessage: string;
  ApproveTime: number;
  VerifyChannel: string;
}

export interface FlowGroupInfo {
  FlowGroupId: string;
  FlowGroupName: string;
}

// 印章操作回调
export interface OperateSealData {
  OrganizationId?: string;
  OperatorUserId?: string;
  SealId: string;
  SealName: string;
  SealType: string;
  Operate: string;
  AuthorizedUsers?: AuthorizedUser[];
  ReviewStatus?: string;
  ReviewReason?: string;
  NodeName?: string;
  NodeStatus?: string;
  ReviewUserId?: string;
}

export interface AuthorizedUser {
  UserId: string;
  UserName: string;
}

// 模板操作回调
export interface TemplateOperationData {
  OrganizationId: string;
  OperatorUserId: string;
  TemplateId: string;
  ShareTemplateId: string;
  TemplateName: string;
  UserData: string;
  CreateTime?: number;
  UpdateTime?: number;
  DeleteTime?: number;
  OperateOn?: number;
  TemplateStatus?: string;
  UserFlowTypeId?: string;
}

// 用印记录回调
export interface SealUseData {
  SealUseCallbackRecords: SealUseRecord[];
}

export interface SealUseRecord {
  SealId: string;
  SealName: string;
  FlowId: string;
  FlowName: string;
  SignCount: number;
  CreatorId: string;
  CreatorName: string;
  SignTime: number;
  AuditUserId: string;
  AuditUserName: string;
  AuditTime: number;
  OrganizationId: string;
}

// 消息类型枚举 - 自建应用 (company)
export enum CallbackMsgType {
  // 合同相关
  FLOW_STATUS_CHANGE = 'FlowStatusChange',
  FLOW_COST = 'FlowCost',
  FORWARD_FLOW = 'ForwardFLow',
  CREATE_FLOW_REVIEW = 'CreateFlowReview',
  RECEIVE_FLOW = 'ReceiveFlow',
  APPROVER_DEADLINE_EXPIRED = 'ApproverDeadlineExpired',
  CANCEL_FLOWS = 'CancelFlows',
  DOCUMENT_FILL = 'DocumentFill',
  FLOW_GROUP_STATUS_CHANGE = 'FlowGroupStatusChange',
  REVIEWER_FLOW_READ = 'ReviewerFlowRead',
  // 印章相关
  OPERATE_SEAL = 'OperateSeal',
  EMPLOYEE_SEAL_AUTH = 'EmployeeSealAuth',
  SEAL_USE = 'SealUse',
  // 模板相关
  TEMPLATE_ADD = 'TemplateAdd',
  TEMPLATE_UPDATE = 'TemplateUpdate',
  TEMPLATE_DELETE = 'TemplateDelete',
  TEMPLATE_AVAILABLE = 'TemplateAvailable',
  // 企业员工相关
  VERIFY_STAFF_INFO = 'VerifyStaffInfo',
  ROLES_CHANGE = 'RolesChange',
  APPROVE_EMPLOYEE_JOIN = 'ApproveEmployeeJoin',
  QUITE_JOB = 'QuiteJob',
  SUPER_ADMIN_CHANGE = 'SuperAdminChange',
  MODIFY_ORGANIZATION_BASE_INFO = 'ModifyOrganizationBaseInfo',
  CLOSE_ORGANIZATION = 'CloseOrganization',
  SUB_ORGANIZATION_JOIN = 'SubOrganizationJoinOrganizationGroup',
  UNBIND_ORGANIZATION_GROUP = 'UnbindOrganizationGroup',
  OPERATE_EXTENDED_SERVICE = 'OperateExtendedService',
  CREATE_ORGANIZATION = 'CreateOrganization',
  USER_ACCOUNT_VERIFY = 'UserAccountVerify',
  USER_MOBILE_CHANGE = 'UserMobileChange',
  ORGANIZATION_AUTHORIZATION = 'OrganizationAuthorization',
  ORG_AUTHORIZATION_FILE_SUBMIT = 'OrgAuthorizationFileSubmit',
  ORGANIZATION_AUTHORIZATION_FILE_REVIEW = 'OrganizationAuthorizationFileReview',
  ORG_AUTHORIZATION_FILE_INVALID = 'OrgAuthorizationFileInvalid',
  USER_NAME_CHANGE = 'UserNameChange',
  // 其他功能
  CREATE_FLOW_BY_QR_CODE = 'CreateFlowByQrCode',
  MULTI_FLOW_SIGN_QR_CODE_COST = 'MultiFlowSignQrCodeCost',
  PARTNER_SERVER_SIGN_AUTHORIZATION = 'PartnerServerSignAuthorization',
  // 费用相关
  BILLING_USE = 'BillingUse',
  // 个人医疗自动签
  OPEN_USER_AUTO_SIGN = 'OpenUserAutoSign',
  AUTO_SIGN_SEAL_IMG = 'AutoSignSealImg',
  DISABLE_USER_AUTO_SIGN = 'DisableUserAutoSign',
  CANCEL_USER_AUTO_SIGN = 'CancelUserAutoSign',
  // 合同智能相关
  AI_CONTRACT_REVIEW = 'AIContractReview',
  AI_INFORMATION_EXTRACTION = 'AIInformationExtraction',
  // 合同对比相关
  CONTRACT_DIFF_TASK_FINISH = 'ContractDiffTaskFinish',
  CONTRACT_DIFF_TASK_CREATE = 'ContractDiffTaskCreate',
}

// 第三方应用额外的消息类型
export enum PartnerCallbackMsgType {
  // 印章相关（第三方独有）
  AUDIT_SEAL_AUTH = 'AuditSealAuth',
  SEAL_POLICY_WORKFLOW = 'SealPolicyWorkflow',
  // 企业员工相关（第三方独有）
  ORG_AUTH = 'OrgAuth',
  VERIFY_STAFF_FAIL = 'VerifyStaffFail',
  OPERATOR_AUTH = 'OperatorAuth',
  LEGAL_PERSON_CHANGE_OPEN_ID = 'LegalPersonChangeOpenId',
  ORG_CERTIFY = 'OrgCertify',
  ORG_AUTHORIZATION_PAYMENT_STATUS_CHANGE = 'OrgAuthorizationPaymentStatusChange',
  ORG_OPEN_TSIGN_BIZ = 'OrgOpenTsignBiz',
  ORG_AUTH_AUDIT = 'OrgAuthAudit',
  // 合同智能相关（第三方）
  FLOW_RISK_IDENTIFY = 'FlowRiskIdentify',
}

/** 所有已知的回调事件类型值集合（自建 + 第三方） */
export const ALL_KNOWN_MSG_TYPES: ReadonlySet<string> = new Set([
  ...Object.values(CallbackMsgType),
  ...Object.values(PartnerCallbackMsgType),
]);
