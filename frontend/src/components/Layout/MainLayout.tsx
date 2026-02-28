import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Menu } from 'tdesign-react';
import {
  LinkIcon,
  TagIcon,
  SettingIcon,
  MenuFoldIcon,
  MenuUnfoldIcon,
} from 'tdesign-icons-react';

const { MenuItem } = Menu;

const menuItems = [
  { path: '/', label: '回调配置', icon: <LinkIcon /> },
  { path: '/tags', label: '标签管理', icon: <TagIcon /> },
  { path: '/settings', label: '系统设置', icon: <SettingIcon /> },
];

const MainLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const currentPath = location.pathname === '/' ? '/' : location.pathname;

  return (
    <div className="flex h-screen bg-[#f0f2f5] overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${
          collapsed ? 'w-[64px]' : 'w-[240px]'
        } bg-white shadow-lg flex flex-col transition-all duration-300 ease-in-out flex-shrink-0`}
      >
        {/* Logo */}
        <div className="h-[64px] flex items-center justify-center border-b border-gray-100 px-4">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center">
                <span className="text-white text-sm font-bold">签</span>
              </div>
              <span className="text-base font-semibold text-gray-800 whitespace-nowrap">回调分发服务</span>
            </div>
          )}
          {collapsed && (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center">
              <span className="text-white text-sm font-bold">签</span>
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
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
