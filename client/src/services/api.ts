// API configuration
const API_BASE_URL = '/api';

interface ApiRequestOptions extends RequestInit {
  requireAuth?: boolean;
}

class ApiService {
  private static instance: ApiService;

  constructor() {}

  static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  private async makeRequest(
    endpoint: string, 
    options: ApiRequestOptions = {}
  ): Promise<Response> {
    const { requireAuth = true, ...fetchOptions } = options;
    
    const url = `${API_BASE_URL}${endpoint}`;
    
    // Default options
    const defaultOptions: RequestInit = {
      credentials: 'include', // Always include cookies for auth
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions.headers,
      },
      ...fetchOptions,
    };

    try {
      const response = await fetch(url, defaultOptions);
      
      // Handle 401 Unauthorized responses
      if (response.status === 401 && requireAuth) {
        throw new Error('Authentication required - please check your login status');
      }
      
      return response;
    } catch (error) {
      console.error(`API request failed for ${endpoint}:`, error);
      throw error;
    }
  }

  // GET request
  async get(endpoint: string, options: ApiRequestOptions = {}): Promise<Response> {
    return this.makeRequest(endpoint, {
      method: 'GET',
      ...options,
    });
  }

  // POST request
  async post(
    endpoint: string, 
    data?: any, 
    options: ApiRequestOptions = {}
  ): Promise<Response> {
    return this.makeRequest(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      ...options,
    });
  }

  // POST request with FormData (for file uploads)
  async postFormData(
    endpoint: string, 
    formData: FormData, 
    options: ApiRequestOptions = {}
  ): Promise<Response> {
    const { headers, ...restOptions } = options;
    
    return this.makeRequest(endpoint, {
      method: 'POST',
      body: formData,
      headers: {
        // Don't set Content-Type for FormData - let browser set it with boundary
        ...headers,
      },
      ...restOptions,
    });
  }

  // PUT request
  async put(
    endpoint: string, 
    data?: any, 
    options: ApiRequestOptions = {}
  ): Promise<Response> {
    return this.makeRequest(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
      ...options,
    });
  }

  // DELETE request
  async delete(endpoint: string, options: ApiRequestOptions = {}): Promise<Response> {
    return this.makeRequest(endpoint, {
      method: 'DELETE',
      ...options,
    });
  }
}

// Create singleton instance
export const apiService = ApiService.getInstance();

// Convenience functions for common API calls
export const geocodeAPI = {
  reverseGeocode: async (latitude: number, longitude: number) => {
    const response = await apiService.post('/geocode', { latitude, longitude });
    if (!response.ok) {
      throw new Error('Geocoding failed');
    }
    return response.json();
  },
};

export const ocrAPI = {
  processImage: async (formData: FormData) => {
    const response = await apiService.postFormData('/ocr', formData);
    if (!response.ok) {
      throw new Error('OCR processing failed');
    }
    return response.json();
  },
  
  correctOCR: async (residentNames: string[], address: any) => {
    const response = await apiService.post('/ocr-correct', { residentNames, address });
    if (!response.ok) {
      throw new Error('OCR correction failed');
    }
    return response.json();
  },
};

export const addressAPI = {
  searchAddress: async (address: any) => {
    const response = await apiService.post('/search-address', address);
    if (!response.ok) {
      throw new Error('Address search failed');
    }
    return response.json();
  },
};

export const customerAPI = {
  getAllCustomers: async () => {
    const response = await apiService.get('/customers');
    if (!response.ok) {
      throw new Error('Failed to fetch customers');
    }
    return response.json();
  },
};

export const authAPI = {
  login: async (password: string) => {
    const response = await apiService.post('/auth/login', { password }, { requireAuth: false });
    return response;
  },
  
  logout: async () => {
    const response = await apiService.post('/auth/logout', undefined, { requireAuth: false });
    return response;
  },
  
  checkAuth: async () => {
    const response = await apiService.get('/auth/check', { requireAuth: false });
    return response;
  },
};

export const datasetAPI = {
  createDataset: async (data: any) => {
    const response = await apiService.post('/address-datasets', data);
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        const errorText = await response.text();
        errorData = { error: errorText };
      }
      
      // Create error object with response data
      const error: any = new Error(errorData.message || errorData.error || 'Failed to create dataset');
      error.response = { status: response.status, data: errorData };
      throw error;
    }
    return response.json();
  },
  
  getDatasets: async (address: any) => {
    const params = new URLSearchParams(address).toString();
    const response = await apiService.get(`/address-datasets?${params}`);
    if (!response.ok) {
      throw new Error('Failed to fetch datasets');
    }
    return response.json();
  },
  
  updateResident: async (data: any) => {
    const response = await apiService.put('/address-datasets/residents', data);
    if (!response.ok) {
      throw new Error('Failed to update resident');
    }
    return response.json();
  },

  bulkUpdateResidents: async (datasetId: string, editableResidents: any[]) => {
    const response = await apiService.put('/address-datasets/bulk-residents', {
      datasetId,
      editableResidents,
    });
    if (!response.ok) {
      throw new Error('Failed to bulk update residents');
    }
    return response.json();
  },
  
  getUserHistory: async (username: string, date: string) => {
    const response = await apiService.get(`/address-datasets/history/${username}/${date}`);
    if (!response.ok) {
      throw new Error('Failed to fetch user history');
    }
    return response.json();
  },
  
  getDatasetById: async (id: string) => {
    const response = await apiService.get(`/address-datasets/${id}`);
    if (!response.ok) {
      throw new Error('Failed to fetch dataset');
    }
    return response.json();
  },
};