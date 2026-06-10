import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
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
        {/* Incidents (formerly Cases) */}
        <Route path="incidents" element={<CaseList />} />
        <Route path="incidents/:id" element={<CaseDetail />} />
        {/* Legacy /cases redirect so old bookmarks still work */}
        <Route path="cases" element={<Navigate to="/incidents" replace />} />
        <Route path="cases/:id" element={<RedirectCaseToIncident />} />
        <Route path="tabletop" element={<Tabletop />} />
        <Route path="tabletop/exercises/:id" element={<ExerciseDetail />} />
        <Route path="tabletop/exercises/:id/after-action" element={<AfterAction />} />
        <Route path="compliance" element={<CompliancePage />} />
        <Route path="compliance/all" element={<CompliancePage />} />
        <Route path="compliance/instances/:id" element={<ComplianceCheckDetail />} />
        <Route path="key-inventory" element={<KeyInventory />} />
        <Route path="org-settings" element={<OrgSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RedirectCaseToIncident() {
  const { id } = useParams();
  return <Navigate to={`/incidents/${id}`} replace />;
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
