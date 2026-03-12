import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, MessagePlugin } from 'tdesign-react';
import { LockOnIcon, UserIcon } from 'tdesign-icons-react';
import { login } from '../lib/api';
import { setAuth } from '../lib/auth';
import logoSvg from '../assets/img/bigger-dzq.svg';

const { FormItem } = Form;

const LoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (ctx: any) => {
    if (ctx.validateResult !== true) return;
    const { username, password } = ctx.fields;
    setLoading(true);
    try {
      const data = await login(username, password);
      setAuth(data.token, data.username);
      MessagePlugin.success('登录成功');
      navigate('/', { replace: true });
    } catch (err: any) {
      const msg = err?.response?.data?.message || '登录失败，请检查用户名和密码';
      MessagePlugin.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Brand Panel */}
      <div
        className="hidden lg:flex lg:w-[52%] relative overflow-hidden items-center justify-center"
        style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        }}
      >
        {/* Decorative circles */}
        <div className="absolute -top-20 -left-20 w-80 h-80 rounded-full opacity-10 bg-white" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-10 bg-white" />
        <div className="absolute top-1/3 right-10 w-40 h-40 rounded-full opacity-5 bg-white" />

        <div className="relative z-10 px-16 max-w-lg">
          <div className="bg-white/15 backdrop-blur-sm rounded-2xl p-4 inline-block mb-8">
            <img src={logoSvg} alt="logo" className="h-10" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-4 leading-tight">
            回调分发服务
          </h1>
          <p className="text-lg text-white/80 mb-8 leading-relaxed">
            TSign Callback Dispatcher
          </p>
          <div className="space-y-4">
            {[
              { title: '智能路由', desc: '基于标签规则精准分发回调事件' },
              { title: '实时监控', desc: '可视化查看回调处理状态与日志' },
              { title: '灵活配置', desc: '支持多回调地址与优先级管理' },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-white" />
                </div>
                <div>
                  <div className="text-white font-medium text-sm">{item.title}</div>
                  <div className="text-white/60 text-xs mt-0.5">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Login Panel */}
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-100 p-6">
        <div className="w-full max-w-[380px]">
          {/* Mobile logo (visible only on small screens) */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center rounded-2xl shadow-lg mb-4 p-3 bg-white">
              <img src={logoSvg} alt="logo" className="h-10" />
            </div>
            <h1 className="text-xl font-bold text-gray-800">回调分发服务</h1>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900">欢迎回来</h2>
            <p className="text-sm text-gray-500 mt-2">请登录您的管理账号以继续</p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg shadow-gray-200/50 p-8 border border-gray-100/80">
            <Form onSubmit={handleSubmit} colon labelWidth={0}>
              <div className="mb-1">
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">用户名</label>
              </div>
              <FormItem name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input
                  prefixIcon={<UserIcon />}
                  placeholder="请输入用户名"
                  size="large"
                  clearable
                />
              </FormItem>
              <div className="mb-1">
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">密码</label>
              </div>
              <FormItem name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input
                  prefixIcon={<LockOnIcon />}
                  placeholder="请输入密码"
                  type="password"
                  size="large"
                />
              </FormItem>
              <FormItem>
                <Button
                  type="submit"
                  theme="primary"
                  block
                  size="large"
                  loading={loading}
                  style={{
                    borderRadius: '10px',
                    height: '44px',
                    fontSize: '15px',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    border: 'none',
                  }}
                >
                  登 录
                </Button>
              </FormItem>
            </Form>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            首次登录请使用默认账号，登录后请及时修改密码
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
