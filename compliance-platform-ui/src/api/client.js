import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) throw new Error('No refresh token');
        const { data } = await axios.post('/api/auth/refresh', { refreshToken });
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        localStorage.clear();
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export const authApi = {
  login:  (email, password) => api.post('/auth/login', { email, password }),
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }),
  me:     () => api.get('/auth/me'),
};

export const casesApi = {
  list:              (params) => api.get('/cases', { params }),
  get:               (id) => api.get(`/cases/${id}`),
  create:            (data) => api.post('/cases', data),
  status:            (id, status) => api.patch(`/cases/${id}/status`, { status }),
  requirements:      (id) => api.get(`/cases/${id}/requirements`),
  updateRequirement: (id, ref, status, notes) =>
    api.patch(`/cases/${id}/requirements/${encodeURIComponent(ref)}`, { status, notes }),
  delete:            (id) => api.delete(`/cases/${id}`),
};

export const actionsApi = {
  list:   (caseId) => api.get(`/cases/${caseId}/actions`),
  create: (caseId, data) => api.post(`/cases/${caseId}/actions`, data),
};

export const evidenceApi = {
  list:   (caseId) => api.get(`/cases/${caseId}/evidence`),
  upload: (caseId, formData) => api.post(`/cases/${caseId}/evidence`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
};

export const notificationsApi = {
  list:     (caseId) => api.get(`/cases/${caseId}/notifications`),
  create:   (caseId, data) => api.post(`/cases/${caseId}/notifications`, data),
  markSent: (caseId, nid, notes) => api.patch(`/cases/${caseId}/notifications/${nid}/sent`, { notes }),
};

export const scenariosApi = {
  list:   () => api.get('/scenarios'),
  get:    (id) => api.get(`/scenarios/${id}`),
  create: (data) => api.post('/scenarios', data),
};

export const exercisesApi = {
  list:       () => api.get('/exercises'),
  get:        (id) => api.get(`/exercises/${id}`),
  create:     (data) => api.post('/exercises', data),
  start:      (id) => api.patch(`/exercises/${id}/start`),
  end:        (id) => api.patch(`/exercises/${id}/end`),
  afterAction:(id) => api.get(`/exercises/${id}/after-action`),
};

export const gapsApi = {
  list:      (exerciseId) => api.get(`/exercises/${exerciseId}/gaps`),
  create:    (exerciseId, data) => api.post(`/exercises/${exerciseId}/gaps`, data),
  remediate: (exerciseId, gid) => api.patch(`/exercises/${exerciseId}/gaps/${gid}/remediate`),
};

export default api;

export const exportsApi = {
  generate: (caseId) => api.post(`/cases/${caseId}/export`),
};

export const orgSettingsApi = {
  get:    () => api.get('/org-settings'),
  update: (data) => api.patch('/org-settings', data),
};

export const calendarApi = {
  current:      () => api.get('/compliance-calendar/current'),
  definitions:  () => api.get('/compliance-calendar/definitions'),
  instances:    (params) => api.get('/compliance-calendar/instances', { params }),
  getInstance:  (id) => api.get(`/compliance-calendar/instances/${id}`),
  updateInstance:(id, data) => api.patch(`/compliance-calendar/instances/${id}`, data),
  uploadEvidence:(id, formData) => api.post(`/compliance-calendar/instances/${id}/evidence`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  signoff:      (id, data) => api.post(`/compliance-calendar/instances/${id}/signoff`, data),
  createManual: (data) => api.post('/compliance-calendar/instances', data),
  refresh:      () => api.post('/compliance-calendar/refresh'),
};
