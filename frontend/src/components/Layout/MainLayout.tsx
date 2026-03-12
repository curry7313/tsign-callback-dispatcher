import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Menu, Button, Dropdown, MessagePlugin, Dialog, Form, Input } from 'tdesign-react';
import {
  LinkIcon,
  TagIcon,
  SettingIcon,
  MenuFoldIcon,
  MenuUnfoldIcon,
  UserCircleIcon,
  LogoutIcon,
  LockOnIcon,
} from 'tdesign-icons-react';
import { getUsername, clearAuth } from '../../lib/auth';
import { changePassword } from '../../lib/api';
import logoSvg from '../../assets/img/bigger-dzq.svg';

const { MenuItem } = Menu;
const { FormItem } = Form;

const menuItems = [
  { path: '/', label: '回调配置', icon: <LinkIcon /> },
  { path: '/tags', label: '标签管理', icon: <TagIcon /> },
  { path: '/settings', label: '系统设置', icon: <SettingIcon /> },
];

const MainLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [passwordDialogVisible, setPasswordDialogVisible] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const currentPath = location.pathname === '/' ? '/' : location.pathname;
  const username = getUsername() || 'admin';

  const handleLogout = () => {
    clearAuth();
    MessagePlugin.success('已退出登录');
    navigate('/login', { replace: true });
  };

  const handlePasswordSubmit = async (ctx: any) => {
    if (ctx.validateResult !== true) return;
    const { oldPassword, newPassword } = ctx.fields;
    setPasswordLoading(true);
    try {
      await changePassword(oldPassword, newPassword);
      MessagePlugin.success('密码修改成功');
      setPasswordDialogVisible(false);
    } catch (err: any) {
      const msg = err?.response?.data?.message || '密码修改失败';
      MessagePlugin.error(msg);
    } finally {
      setPasswordLoading(false);
    }
  };

  const dropdownOptions = [
    { content: '修改密码', value: 'password', prefixIcon: <LockOnIcon /> },
    { content: '退出登录', value: 'logout', prefixIcon: <LogoutIcon />, theme: 'error' as const },
  ];

  const handleDropdownClick = (data: any) => {
    if (data.value === 'logout') {
      handleLogout();
    } else if (data.value === 'password') {
      setPasswordDialogVisible(true);
    }
  };

  return (
    <div className="flex h-screen bg-[#f0f2f5] overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${
          collapsed ? 'w-[64px]' : 'w-[240px]'
        } bg-white shadow-lg flex flex-col transition-all duration-300 ease-in-out flex-shrink-0`}
      >
        {/* Logo */}
        <div className={`${collapsed ? 'h-[64px] flex items-center justify-center' : 'pt-4 pb-3'} border-b border-gray-100 px-4 overflow-hidden`}>
          {!collapsed ? (
            <div className="flex flex-col items-center gap-1">
              <img src={logoSvg} alt="logo" className="h-7 flex-shrink-0" />
              <span className="text-sm font-semibold text-gray-800">回调分发服务</span>
            </div>
          ) : (
            <div className="flex items-center justify-center w-full">
              <img src={logoSvg} alt="logo" className="w-8 h-8 object-contain object-left" style={{ clipPath: 'inset(0 80% 0 0)' }} />
            </div>
          )}
        </div>

        {/* Menu */}
        <div className="flex-1 py-2">
          <Menu
            value={currentPath}
            collapsed={collapsed}
            onChange={(value) => navigate(value as string)}
            style={{ border: 'none' }}
          >
            {menuItems.map((item) => (
              <MenuItem key={item.path} value={item.path} icon={item.icon}>
                {item.label}
              </MenuItem>
            ))}
          </Menu>
        </div>

        {/* Collapse Toggle */}
        <div className="border-t border-gray-100 p-3">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-gray-50 text-gray-500 transition-colors cursor-pointer"
          >
            {collapsed ? <MenuUnfoldIcon size={18} /> : <MenuFoldIcon size={18} />}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-[64px] bg-white shadow-sm flex items-center justify-between px-6 flex-shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-gray-800">
              {menuItems.find((m) => m.path === currentPath)?.label || '电子签回调分发'}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span>服务运行中</span>
            </div>
            <Dropdown options={dropdownOptions} onClick={handleDropdownClick}>
              <Button variant="text" shape="round" icon={<UserCircleIcon />}>
                {username}
              </Button>
            </Dropdown>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* Change Password Dialog */}
      <Dialog
        header="修改密码"
        visible={passwordDialogVisible}
        onClose={() => setPasswordDialogVisible(false)}
        footer={false}
        width={420}
      >
        <Form onSubmit={handlePasswordSubmit} colon labelWidth={80} labelAlign="right">
          <FormItem label="当前密码" name="oldPassword" rules={[{ required: true, message: '请输入当前密码' }]}>
            <Input type="password" placeholder="请输入当前密码" />
          </FormItem>
          <FormItem
            label="新密码"
            name="newPassword"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '密码至少8位' },
            ]}
          >
            <Input type="password" placeholder="至少8位字符" />
          </FormItem>
          <FormItem
            label="确认密码"
            name="confirmPassword"
            rules={[
              { required: true, message: '请确认新密码' },
              {
                validator: (val: string) => {
                  // Will be validated in submit handler
                  return true;
                },
              },
            ]}
          >
            <Input type="password" placeholder="再次输入新密码" />
          </FormItem>
          <FormItem style={{ textAlign: 'right' }}>
            <Button
              theme="default"
              onClick={() => setPasswordDialogVisible(false)}
              style={{ marginRight: 8 }}
            >
              取消
            </Button>
            <Button type="submit" theme="primary" loading={passwordLoading}>
              确认修改
            </Button>
          </FormItem>
        </Form>
      </Dialog>
    </div>
  );
};

export default MainLayout;
