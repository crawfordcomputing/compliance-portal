import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CaseList from './pages/CaseList';
import CaseDetail from './pages/CaseDetail';
import Tabletop from './pages/Tabletop';
import ExerciseDetail from './pages/ExerciseDetail';
import AfterAction from './pages/AfterAction';
import CompliancePage from './pages/CompliancePage';
import ComplianceCheckDetail from './pages/ComplianceCheckDetail';
import OrgSettings from './pages/OrgSettings';
import KeyInventory from './pages/KeyInventory';
import Layout from './components/Layout';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="cases" element={<CaseList />} />
        <Route path="cases/:id" element={<CaseDetail />} />
        <Route path="tabletop" element={<Tabletop />} />
        <Route path="tabletop/exercises/:id" element={<ExerciseDetail />} />
        <Route path="tabletop/exercises/:id/after-action" element={<AfterAction />} />
        <Route path="compliance" element={<CompliancePage />} />
        <Route path="compliance/instances/:id" element={<ComplianceCheckDetail />} />
        <Route path="key-inventory" element={<KeyInventory />} />
        <Route path="org-settings" element={<OrgSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
