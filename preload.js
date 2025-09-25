const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Global settings
  getGlobalSettings: () => ipcRenderer.invoke('get-global-settings'),
  saveGlobalSettings: (settings) => ipcRenderer.invoke('save-global-settings', settings),
  printBillHtml: (billHtml) => ipcRenderer.invoke('print-bill-html', billHtml),
  // Authentication
  login: (credentials) => ipcRenderer.invoke('login', credentials),
  authenticateUser: (branchPassword) => ipcRenderer.invoke('authenticateUser', branchPassword),
  
  // Branch management
  loadBranchFile: (branchCode) => ipcRenderer.invoke('load-branch-file', branchCode),
  getAllBranches: () => ipcRenderer.invoke('get-all-branches'),
  createBranch: (branchDetails) => ipcRenderer.invoke('create-branch', branchDetails),
  deleteBranch: (branchCode) => ipcRenderer.invoke('delete-branch', branchCode),
  
  // Data management
  saveProducts: (products) => ipcRenderer.invoke('save-products', products),
  saveOffers: (offers) => ipcRenderer.invoke('save-offers', offers),
  saveBranchDetails: (details) => ipcRenderer.invoke('save-branch-details', details),
  saveCategories: (categories) => ipcRenderer.invoke('save-categories', categories),
  // Per-branch apis
  getBranchData: (branchCode) => ipcRenderer.invoke('get-branch-data', branchCode),
  // Expose currentBranch globally
  getCurrentBranch: () => ipcRenderer.invoke('get-current-branch'),
  saveProductsForBranch: (payload) => ipcRenderer.invoke('save-products-for-branch', payload),
  saveOffersForBranch: (payload) => ipcRenderer.invoke('save-offers-for-branch', payload),
  saveCategoriesForBranch: (payload) => ipcRenderer.invoke('save-categories-to-all-branches', payload),
  saveCategoriesToAllBranches: (categories) => ipcRenderer.invoke('save-categories-to-all-branches', categories),
  saveBranchDetailsForBranch: (payload) => ipcRenderer.invoke('save-branch-details-for-branch', payload),
  
  // Bill management
  createBill: (billData) => ipcRenderer.invoke('create-bill', billData),
  printBill: (billNo) => ipcRenderer.invoke('print-bill', billNo),
  
  // Reports
  getReports: (filter) => ipcRenderer.invoke('get-reports', filter),
  
  // Sync
  pushSync: () => ipcRenderer.invoke('push-sync'),
  pullSync: () => ipcRenderer.invoke('pull-sync'),
  
  // Window management
  openAdminWindow: () => ipcRenderer.invoke('open-admin-window'),
  openUserWindow: () => ipcRenderer.invoke('open-user-window'),
  closeWindow: (windowType) => ipcRenderer.invoke('close-window', windowType),
  
  // Event listeners
  onWindowClosed: (callback) => {
    ipcRenderer.on('window-closed', callback);
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
  // Generic IPC event methods for OAuth and other custom events
  on: (channel, listener) => ipcRenderer.on(channel, listener),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args)
});
