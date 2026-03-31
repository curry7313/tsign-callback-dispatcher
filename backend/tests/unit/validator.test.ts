import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { validateTagBody } from '../../src/middleware/validator.middleware';

// ---- 辅助函数 ----

function createMockReq(body: Record<string, any>, method = 'POST'): Partial<Request> {
  return { body, method } as Partial<Request>;
}

function createMockRes() {
  const state = { statusCode: null as number | null, responseBody: null as any };
  const res: Partial<Response> = {
    status: vi.fn().mockImplementation((code: number) => {
      state.statusCode = code;
      return res;
    }),
    json: vi.fn().mockImplementation((data: any) => {
      state.responseBody = data;
      return res;
    }),
  };
  return { res, state };
}

// ---- validateTagBody 测试 ----

describe('validateTagBody', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  // ---- 基础校验 ----

  it('name 和 key 都存在时通过校验', () => {
    const req = createMockReq({ name: '消息类型', key: 'MsgType' });
    const { res } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('name 缺失时返回 400', () => {
    const req = createMockReq({ key: 'MsgType' });
    const { res, state } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(400);
    expect(state.responseBody.message).toContain('name is required');
  });

  it('key 缺失时返回 400', () => {
    const req = createMockReq({ name: '消息类型' });
    const { res, state } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(400);
    expect(state.responseBody.message).toContain('key is required');
  });

  it('key 为空字符串时返回 400', () => {
    const req = createMockReq({ name: '消息类型', key: '' });
    const { res, state } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(400);
  });

  it('key 为纯空格时返回 400', () => {
    const req = createMockReq({ name: '消息类型', key: '   ' });
    const { res, state } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(400);
  });

  // ---- 标签 key 格式校验：支持点号字段路径 ----

  it('纯字母 key (MsgType) 通过校验', () => {
    const req = createMockReq({ name: '消息类型', key: 'MsgType' });
    const { res } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('带下划线的 key (flow_type) 通过校验', () => {
    const req = createMockReq({ name: '合同类型', key: 'flow_type' });
    const { res } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('带数字的 key (tag123) 通过校验', () => {
    const req = createMockReq({ name: '标签', key: 'tag123' });
    const { res } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('带点号的字段路径 key (MsgData.FlowName) 通过校验', () => {
    const req = createMockReq({ name: '合同名称', key: 'MsgData.FlowName' });
    const { res } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('带点号的字段路径 key (MsgData.FlowCallbackStatus) 通过校验', () => {
    const req = createMockReq({ name: '合同状态', key: 'MsgData.FlowCallbackStatus' });
    const { res } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('带点号的字段路径 key (MsgData.Operate) 通过校验', () => {
    const req = createMockReq({ name: '操作类型', key: 'MsgData.Operate' });
    const { res } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('带点号的字段路径 key (MsgData.OrganizationId) 通过校验', () => {
    const req = createMockReq({ name: '组织ID', key: 'MsgData.OrganizationId' });
    const { res } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('带点号的字段路径 key (MsgData.UserData) 通过校验', () => {
    const req = createMockReq({ name: '用户数据', key: 'MsgData.UserData' });
    const { res } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('多层嵌套点号路径 (A.B.C.D) 通过校验', () => {
    const req = createMockReq({ name: '深层字段', key: 'A.B.C.D' });
    const { res } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  // ---- 非法字符拒绝 ----

  it('包含空格的 key 被拒绝', () => {
    const req = createMockReq({ name: '标签', key: 'Msg Type' });
    const { res, state } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(400);
  });

  it('包含中划线的 key 被拒绝', () => {
    const req = createMockReq({ name: '标签', key: 'flow-type' });
    const { res, state } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(400);
  });

  it('包含特殊字符的 key 被拒绝', () => {
    const req = createMockReq({ name: '标签', key: 'tag@key' });
    const { res, state } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(400);
  });

  it('包含中文的 key 被拒绝', () => {
    const req = createMockReq({ name: '标签', key: '标签键' });
    const { res, state } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(400);
  });

  it('包含斜杠的 key 被拒绝', () => {
    const req = createMockReq({ name: '标签', key: 'MsgData/FlowName' });
    const { res, state } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(400);
  });

  // ---- type 校验 ----

  it('type 为 text 时通过', () => {
    const req = createMockReq({ name: '标签', key: 'MsgType', type: 'text' });
    const { res } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('type 为 select 时通过', () => {
    const req = createMockReq({ name: '标签', key: 'MsgType', type: 'select' });
    const { res } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('type 为无效值时返回 400', () => {
    const req = createMockReq({ name: '标签', key: 'MsgType', type: 'invalid' });
    const { res, state } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(400);
    expect(state.responseBody.message).toContain('type must be');
  });

  it('type 不传时通过（可选字段）', () => {
    const req = createMockReq({ name: '标签', key: 'MsgType' });
    const { res } = createMockRes();
    validateTagBody(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  // ---- 所有 COMMON_FIELDS 可用值一次性验证 ----

  const COMMON_FIELD_KEYS = [
    'MsgType',
    'MsgData.FlowName',
    'MsgData.Operate',
    'MsgData.FlowCallbackStatus',
    'MsgData.OrganizationId',
    'MsgData.UserData',
	'MsgData.FlowCallbackShowStatus'
  ];

  it.each(COMMON_FIELD_KEYS)(
    '前端 COMMON_FIELDS 中的 key "%s" 通过后端校验',
    (key) => {
      const req = createMockReq({ name: `标签-${key}`, key });
      const { res } = createMockRes();
      validateTagBody(req as Request, res as Response, next);
      expect(next).toHaveBeenCalled();
    }
  );
});
