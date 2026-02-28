import React from 'react';
import { Routes, Route } from 'react-router-dom';
import MainLayout from './components/Layout/MainLayout';
import CallbackManagementPage from './pages/CallbackManagementPage';
import TagManagementPage from './pages/TagManagementPage';
import SettingsPage from './pages/SettingsPage';

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<MainLayout />}>
        <Route index element={<CallbackManagementPage />} />
        <Route path="callbacks" element={<CallbackManagementPage />} />
        <Route path="tags" element={<TagManagementPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
};

export default App;
