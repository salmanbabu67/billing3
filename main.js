process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const bcrypt = require('bcrypt');
const { google } = require('googleapis');
const archiver = require('archiver');
const unzipper = require('unzipper');

// Global variables
// Google Drive config
const DRIVE_FOLDER_ID = '1JwJxZin35ZjFjDw6VxPCg2HVpw9VmzOb'; // <-- Set your folder ID here
const OAUTH_CREDENTIALS_PATH = path.join(__dirname, 'client_id.json');
const OAUTH_TOKEN_PATH = path.join(__dirname, 'tokens.json');
let oAuth2Client = null;

function getOAuth2Client(callback) {
  if (!fs.existsSync(OAUTH_CREDENTIALS_PATH)) {
    console.error('OAuth client_id.json not found.');
    return null;
  }
  const credentials = JSON.parse(fs.readFileSync(OAUTH_CREDENTIALS_PATH));
  const { client_id, client_secret, redirect_uris } = credentials.installed;
  oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  if (fs.existsSync(OAUTH_TOKEN_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(OAUTH_TOKEN_PATH));
    oAuth2Client.setCredentials(tokens);
    if (callback) callback(oAuth2Client);
    return oAuth2Client;
  } else {
    // First time: prompt user for consent
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/drive.file']
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    // Use prompt-sync for CLI input
    const prompt = require('prompt-sync')();
    const code = prompt('Enter the code from that page here: ');
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);
      fs.writeFileSync(OAUTH_TOKEN_PATH, JSON.stringify(token));
      if (callback) callback(oAuth2Client);
    });
    return oAuth2Client;
  }
}
let mainWindow;
let adminWindow;
let userWindow;
let currentBranch = null;
let currentUser = null;
let inMemoryData = {
  branchDetails: null,
  products: [],
  offers: [],
  bills: [],
  billItems: [],
  settings: {},
  categories: []
};

// Excel file utilities
class ExcelManager {
  constructor() {
    this.branchFilePath = null;
  }

  setBranchPath(branchCode) {
    this.branchFilePath = path.join(__dirname, 'data', `branch_${branchCode}.xlsx`);
    // Ensure data directory exists
    const dataDir = path.dirname(this.branchFilePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  async loadBranchData(branchCode) {
    if (!this.branchFilePath || !fs.existsSync(this.branchFilePath)) {
      return this.createNewBranchFile();
    }

    try {
      const workbook = XLSX.readFile(this.branchFilePath);

      // Load branch details
      if (workbook.Sheets['branch_details']) {
        const branchData = XLSX.utils.sheet_to_json(workbook.Sheets['branch_details']);
        inMemoryData.branchDetails = branchData[0] || {};
      }

      // Load products
      if (workbook.Sheets['products']) {
        let allProducts = XLSX.utils.sheet_to_json(workbook.Sheets['products']);
        // Only keep products for the branchCode passed in
        inMemoryData.products = allProducts.filter(p => p.branch === branchCode);
      }

      // Load offers
      if (workbook.Sheets['offers']) {
        inMemoryData.offers = XLSX.utils.sheet_to_json(workbook.Sheets['offers']);
        console.log('Loaded offers for', this.branchFilePath, inMemoryData.offers);
      }

      // Load categories
      if (workbook.Sheets['categories']) {
        const cats = XLSX.utils.sheet_to_json(workbook.Sheets['categories']);
        inMemoryData.categories = cats.map(c => c.name).filter(Boolean);
      } else {
        inMemoryData.categories = [];
      }

      // Load bills (only today and yesterday)
      if (workbook.Sheets['bills']) {
        const allBills = XLSX.utils.sheet_to_json(workbook.Sheets['bills']);
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        console.log('[DEBUG] All bills from Excel:', allBills);
        inMemoryData.bills = allBills.filter(bill =>
          bill.date_iso === today || bill.date_iso === yesterday
        );
        console.log('[DEBUG] inMemoryData.bills after filter:', inMemoryData.bills);
      }

      // Load bill items (only for today and yesterday)
      if (workbook.Sheets['bill_items']) {
        const allBillItems = XLSX.utils.sheet_to_json(workbook.Sheets['bill_items']);
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const todayBills = inMemoryData.bills.map(b => b.bill_no);
        inMemoryData.billItems = allBillItems.filter(item =>
          todayBills.includes(item.bill_no)
        );
      }

      // Load settings
      if (workbook.Sheets['settings']) {
        const settingsData = XLSX.utils.sheet_to_json(workbook.Sheets['settings']);
        inMemoryData.settings = {};
        settingsData.forEach(setting => {
          inMemoryData.settings[setting.key] = setting.value;
        });
      }

      return true;
    } catch (error) {
      console.error('Error loading branch data:', error);
      return false;
    }
  }

  async createNewBranchFile() {
    const workbook = XLSX.utils.book_new();
    
    // Create branch_details sheet using inMemoryData.branchDetails (populated from form)
    const branchDetails = [{
      branch_code: inMemoryData.branchDetails.branch_code || currentBranch,
      name: inMemoryData.branchDetails.name || '',
      password: inMemoryData.branchDetails.password || '123456',
      gst: inMemoryData.branchDetails.gst || '',
      fssai: inMemoryData.branchDetails.fssai || '',
      bill_address: inMemoryData.branchDetails.bill_address || '',
      phone: inMemoryData.branchDetails.phone || '',
      email: inMemoryData.branchDetails.email || '',
      last_sync_ts: new Date().toISOString()
    }];
    const branchSheet = XLSX.utils.json_to_sheet(branchDetails);
    XLSX.utils.book_append_sheet(workbook, branchSheet, 'branch_details');

    // Create products sheet
    const productsSheet = XLSX.utils.json_to_sheet([]);
    XLSX.utils.book_append_sheet(workbook, productsSheet, 'products');

    // Create offers sheet
    const offersSheet = XLSX.utils.json_to_sheet([]);
    XLSX.utils.book_append_sheet(workbook, offersSheet, 'offers');

    // Create categories sheet
    const categoriesSheet = XLSX.utils.json_to_sheet([]);
    XLSX.utils.book_append_sheet(workbook, categoriesSheet, 'categories');

    // Create bills sheet
    const billsSheet = XLSX.utils.json_to_sheet([]);
    XLSX.utils.book_append_sheet(workbook, billsSheet, 'bills');

    // Create bill_items sheet
    const billItemsSheet = XLSX.utils.json_to_sheet([]);
    XLSX.utils.book_append_sheet(workbook, billItemsSheet, 'bill_items');

    // Create settings sheet
    const settings = [
      { key: 'lastCleanupDate', value: new Date().toISOString().split('T')[0] },
      { key: 'version', value: '1.0.0' }
    ];
    const settingsSheet = XLSX.utils.json_to_sheet(settings);
    XLSX.utils.book_append_sheet(workbook, settingsSheet, 'settings');

    // Create users sheet
    const users = [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'user', password: 'user123', role: 'user' }
    ];
    const usersSheet = XLSX.utils.json_to_sheet(users);
    XLSX.utils.book_append_sheet(workbook, usersSheet, 'users');

    try {
      XLSX.writeFile(workbook, this.branchFilePath);
      return true;
    } catch (error) {
      console.error('Error creating branch file:', error);
      return false;
    }
  }

  async saveBranchData() {
    if (!this.branchFilePath) return false;

    try {
      const workbook = XLSX.utils.book_new();

      // Debug log: print bills before saving
      console.log('DEBUG: Bills to be saved in Excel:', JSON.stringify(inMemoryData.bills, null, 2));

      // Save branch details
      const branchSheet = XLSX.utils.json_to_sheet([inMemoryData.branchDetails]);
      XLSX.utils.book_append_sheet(workbook, branchSheet, 'branch_details');

      // Save products
      let productsToSave = inMemoryData.products;
      // If products is empty, preserve existing products sheet
      if ((!productsToSave || productsToSave.length === 0) && fs.existsSync(this.branchFilePath)) {
        try {
          const existingWorkbook = XLSX.readFile(this.branchFilePath);
          if (existingWorkbook.Sheets['products']) {
            productsToSave = XLSX.utils.sheet_to_json(existingWorkbook.Sheets['products']);
          }
        } catch (err) {
          console.error('Error preserving products sheet:', err);
        }
      }
      const productsSheet = XLSX.utils.json_to_sheet(productsToSave || []);
      XLSX.utils.book_append_sheet(workbook, productsSheet, 'products');

      // Save offers
      const offersSheet = XLSX.utils.json_to_sheet(inMemoryData.offers);
      XLSX.utils.book_append_sheet(workbook, offersSheet, 'offers');

      // Save categories
      const categoriesSheet = XLSX.utils.json_to_sheet((inMemoryData.categories || []).map(name => ({ name })));
      XLSX.utils.book_append_sheet(workbook, categoriesSheet, 'categories');

      // Save bills (only today and yesterday)
      const billsSheet = XLSX.utils.json_to_sheet(inMemoryData.bills);
      XLSX.utils.book_append_sheet(workbook, billsSheet, 'bills');

      // Save bill items
      const billItemsSheet = XLSX.utils.json_to_sheet(inMemoryData.billItems);
      XLSX.utils.book_append_sheet(workbook, billItemsSheet, 'bill_items');

      // Save settings
      const settingsArray = Object.entries(inMemoryData.settings).map(([key, value]) => ({ key, value }));
      const settingsSheet = XLSX.utils.json_to_sheet(settingsArray);
      XLSX.utils.book_append_sheet(workbook, settingsSheet, 'settings');

      // Save users (load from existing file if available)
      let users = [];
      if (fs.existsSync(this.branchFilePath)) {
        try {
          const existingWorkbook = XLSX.readFile(this.branchFilePath);
          if (existingWorkbook.Sheets['users']) {
            users = XLSX.utils.sheet_to_json(existingWorkbook.Sheets['users']);
          }
        } catch (error) {
          console.log('No existing users found, using default');
        }
      }
      // If no users exist, create default ones
      if (users.length === 0) {
        users = [
          { username: 'admin', password: 'admin123', role: 'admin' },
          { username: 'user', password: 'user123', role: 'user' }
        ];
      }
      const usersSheet = XLSX.utils.json_to_sheet(users);
      XLSX.utils.book_append_sheet(workbook, usersSheet, 'users');

      XLSX.writeFile(workbook, this.branchFilePath);
      return true;
    } catch (error) {
      console.error('Error saving branch data:', error);
      return false;
    }
  }

  async cleanupOldBills() {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const lastCleanupDate = inMemoryData.settings.lastCleanupDate;

    if (lastCleanupDate !== today) {
      // Remove bills older than yesterday
      inMemoryData.bills = inMemoryData.bills.filter(bill => 
        bill.date_iso === today || bill.date_iso === yesterday
      );

      // Remove corresponding bill items
      const validBillNos = inMemoryData.bills.map(b => b.bill_no);
      inMemoryData.billItems = inMemoryData.billItems.filter(item => 
        validBillNos.includes(item.bill_no)
      );

      // Update cleanup date
      inMemoryData.settings.lastCleanupDate = today;

      // Save the cleaned data
      await this.saveBranchData();
    }
  }

  getNextBillNumber() {
    const today = new Date().toISOString().split('T')[0];
    const todayBills = inMemoryData.bills.filter(bill => bill.date_iso === today);
    
    if (todayBills.length === 0) {
      return 1;
    }
    
    const maxBillNo = Math.max(...todayBills.map(bill => bill.bill_no));
    return maxBillNo + 1;
  }
}

const excelManager = new ExcelManager();

// IPC Handlers

// Print bill HTML in hidden window
ipcMain.handle('print-bill-html', async (event, billHtml) => {
  try {
    const printWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    // Inline user.css for guaranteed styling
    const cssPath = path.join(__dirname, 'css', 'user.css');
    let userCss = '';
    try {
      userCss = fs.readFileSync(cssPath, 'utf8');
    } catch (e) {
      console.error('Could not read user.css:', e);
    }
    const fullHtml = `<!DOCTYPE html>
    <html>
    <head>
      <meta charset='utf-8'>
      <title>Bill Print</title>
      <style>${userCss}</style>
    </head>
    <body>${billHtml}</body>
    </html>`;
    printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml));
    printWin.webContents.on('did-finish-load', async () => {
      await printWin.webContents.print({
        silent: true,
        printBackground: true,
        copies: 1
      });
      // setTimeout(() => { printWin.close(); }, 1000);
    });
    return { success: true };
  } catch (error) {
    console.error('Print bill HTML error:', error);
    return { success: false, message: 'Print failed' };
  }
});

// --- MOCK GOOGLE DRIVE SYNC (REMOVE WHEN TESTING REAL SYNC) ---
// ipcMain.handle('push-sync', async (event) => {
//   console.log('[MOCK] push-sync called');
//   const dataDir = path.join(__dirname, 'data');
//   const files = fs.readdirSync(dataDir).filter(file => file.startsWith('branch_') && file.endsWith('.xlsx'));
//   let allBranchData = [];
//   for (const file of files) {
//     const branchCode = file.replace('branch_', '').replace('.xlsx', '');
//     excelManager.setBranchPath(branchCode);
//     const loaded = await excelManager.loadBranchData(branchCode);
//     if (!loaded) continue;
//     // Update last_sync_ts for each branch
//     inMemoryData.branchDetails.last_sync_ts = new Date().toISOString();
//     await excelManager.saveBranchData();
//     // Log data for each branch
//     console.log(`Pushed branch ${branchCode}:`);
//     console.log('branch_details:', JSON.stringify(inMemoryData.branchDetails, null, 2));
//     console.log('products:', JSON.stringify(inMemoryData.products, null, 2));
//     console.log('offers:', JSON.stringify(inMemoryData.offers, null, 2));
//     allBranchData.push({
//       branch_details: inMemoryData.branchDetails,
//       products: inMemoryData.products,
//       offers: inMemoryData.offers,
//       categories: inMemoryData.categories
//     });
//   }
//   return {
//     success: true,
//     message: '[MOCK] Sync package pushed for all branches (no real upload).',
//     data: allBranchData
//   };
// });

// ipcMain.handle('pull-sync', async (event) => {
//   console.log('[MOCK] pull-sync called');
//   const dataDir = path.join(__dirname, 'data');
//   const files = fs.readdirSync(dataDir).filter(file => file.startsWith('branch_') && file.endsWith('.xlsx'));
//   let allBranchData = [];
//   for (const file of files) {
//     const branchCode = file.replace('branch_', '').replace('.xlsx', '');
//     excelManager.setBranchPath(branchCode);
//     const loaded = await excelManager.loadBranchData(branchCode);
//     if (!loaded) continue;
//     // Log data for each branch
//     console.log(`[MOCK] Pulled branch ${branchCode}:`);
//     console.log('branch_details:', JSON.stringify(inMemoryData.branchDetails, null, 2));
//     console.log('products:', JSON.stringify(inMemoryData.products, null, 2));
//     console.log('offers:', JSON.stringify(inMemoryData.offers, null, 2));
//     allBranchData.push({
//       branch_details: inMemoryData.branchDetails,
//       products: inMemoryData.products,
//       offers: inMemoryData.offers,
//       categories: inMemoryData.categories
//     });
//   }
//   return {
//     success: true,
//     message: '[MOCK] Sync package pulled for all branches (no real download).',
//     data: allBranchData
//   };
// });
// --- END MOCK GOOGLE DRIVE SYNC ---
ipcMain.handle('login', async (event, credentials) => {
  try {
    const { username, password } = credentials;
    
    // Load users from Excel
    if (fs.existsSync(excelManager.branchFilePath)) {
      const workbook = XLSX.readFile(excelManager.branchFilePath);
      if (workbook.Sheets['users']) {
        const users = XLSX.utils.sheet_to_json(workbook.Sheets['users']);
        const user = users.find(u => u.username === username);
        
        if (user && user.password === password) {
          currentUser = user;
          return { success: true, user: { username: user.username, role: user.role } };
        }
      }
    }
    
    return { success: false, message: 'Invalid credentials' };
  } catch (error) {
    console.error('Login error:', error);
    return { success: false, message: 'Login failed' };
  }
});

ipcMain.handle('authenticateUser', async (event, branchPassword) => {
  try {
    // Find branch by password
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      return { success: false, message: 'No branches found' };
    }

    const files = fs.readdirSync(dataDir).filter(file => file.startsWith('branch_') && file.endsWith('.xlsx'));
    
    for (const file of files) {
      const branchCode = file.replace('branch_', '').replace('.xlsx', '');
      const filePath = path.join(dataDir, file);
      
      try {
        const workbook = XLSX.readFile(filePath);
        if (workbook.Sheets['branch_details']) {
          const branchData = XLSX.utils.sheet_to_json(workbook.Sheets['branch_details']);
          const branch = branchData[0];
          
          if (branch && branch.password && branchPassword === branch.password) {
            // Load branch data
            currentBranch = branchCode;
            excelManager.setBranchPath(branchCode);
            const success = await excelManager.loadBranchData();
            if (success) {
              await excelManager.cleanupOldBills();
              return {
                success: true,
                branchCode: branchCode,
                data: {
                  branchDetails: inMemoryData.branchDetails,
                  products: inMemoryData.products,
                  offers: inMemoryData.offers
                }
              };
            }
          }
        }
      } catch (error) {
        console.log(`Error reading ${file}:`, error.message);
        continue;
      }
    }
    
    return { success: false, message: 'Invalid branch password' };
  } catch (error) {
    console.error('User authentication error:', error);
    return { success: false, message: 'Authentication failed' };
  }
});

ipcMain.handle('load-branch-file', async (event, branchCode) => {
  try {
    currentBranch = branchCode;
    excelManager.setBranchPath(branchCode);
    const success = await excelManager.loadBranchData();
    
    if (success) {
      await excelManager.cleanupOldBills();
      return {
        success: true,
        data: {
          branchDetails: inMemoryData.branchDetails,
          products: inMemoryData.products,
          offers: inMemoryData.offers
        }
      };
    }
    
    return { success: false, message: 'Failed to load branch data' };
  } catch (error) {
    console.error('Load branch error:', error);
    return { success: false, message: 'Failed to load branch data' };
  }
});

ipcMain.handle('get-all-branches', async (event) => {
  try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      return { success: true, branches: [] };
    }

    const files = fs.readdirSync(dataDir).filter(file => file.startsWith('branch_') && file.endsWith('.xlsx'));
    const branches = [];

    for (const file of files) {
      const branchCode = file.replace('branch_', '').replace('.xlsx', '');
      const filePath = path.join(dataDir, file);
      
      try {
        const workbook = XLSX.readFile(filePath);
        if (workbook.Sheets['branch_details']) {
          const branchData = XLSX.utils.sheet_to_json(workbook.Sheets['branch_details']);
          if (branchData.length > 0) {
            branches.push(branchData[0]);
          }
        }
      } catch (error) {
        console.log(`Error reading ${file}:`, error.message);
        continue;
      }
    }

    return { success: true, branches };
  } catch (error) {
    console.error('Get all branches error:', error);
    return { success: false, message: 'Failed to load branches' };
  }
});

ipcMain.handle('create-branch', async (event, branchDetails) => {
  try {
    const { branch_code } = branchDetails;
    const filePath = path.join(__dirname, 'data', `branch_${branch_code}.xlsx`);
    
    // Check if branch already exists
    if (fs.existsSync(filePath)) {
      return { success: false, message: 'Branch already exists' };
    }

    // Create new branch file
    currentBranch = branch_code;
    excelManager.setBranchPath(branch_code);
    
    // Set the branch details
    inMemoryData.branchDetails = {
      ...branchDetails,
      password: branchDetails.password,
      last_sync_ts: new Date().toISOString()
    };
    
    // Initialize empty arrays
    inMemoryData.products = [];
    inMemoryData.offers = [];
    inMemoryData.bills = [];
    inMemoryData.billItems = [];
    inMemoryData.settings = {
      lastCleanupDate: new Date().toISOString().split('T')[0],
      version: '1.0.0'
    };

    // Create the Excel file
    const success = await excelManager.createNewBranchFile();
    
    if (success) {
      // Reload branch details from file
      await excelManager.loadBranchData();
      return {
        success: true,
        message: 'Branch created successfully',
        branchDetails: inMemoryData.branchDetails
      };
    } else {
      return { success: false, message: 'Failed to create branch file' };
    }
  } catch (error) {
    console.error('Create branch error:', error);
    return { success: false, message: 'Failed to create branch' };
  }
});

ipcMain.handle('delete-branch', async (event, branchCode) => {
  try {
    const filePath = path.join(__dirname, 'data', `branch_${branchCode}.xlsx`);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true, message: 'Branch deleted successfully' };
    } else {
      return { success: false, message: 'Branch not found' };
    }
  } catch (error) {
    console.error('Delete branch error:', error);
    return { success: false, message: 'Failed to delete branch' };
  }
});

ipcMain.handle('save-products', async (event, products) => {
  try {
    if (!Array.isArray(products)) {
      console.error('Save products called with non-array:', products);
      return { success: false, message: 'Invalid products data' };
    }
    if (products.length === 0) {
      console.warn('Attempt to save empty product list. Operation aborted.');
      return { success: false, message: 'Refusing to overwrite products with empty list.' };
    }
    inMemoryData.products = products;
    console.log('Saving products:', JSON.stringify(products, null, 2));
    const success = await excelManager.saveBranchData();
    return { success };
  } catch (error) {
    console.error('Save products error:', error);
    return { success: false, message: 'Failed to save products' };
  }
});

ipcMain.handle('save-offers', async (event, offers) => {
  try {
    if (!Array.isArray(offers)) {
      console.error('Save offers called with non-array:', offers);
      return { success: false, message: 'Invalid offers data' };
    }
    if (offers.length === 0) {
      console.warn('Attempt to save empty offers list. Operation aborted.');
      return { success: false, message: 'Refusing to overwrite offers with empty list.' };
    }
    inMemoryData.offers = offers;
    console.log('Saving offers:', JSON.stringify(offers, null, 2));
    const success = await excelManager.saveBranchData();
    return { success };
  } catch (error) {
    console.error('Save offers error:', error);
    return { success: false, message: 'Failed to save offers' };
  }
});

// Per-branch operations
ipcMain.handle('get-branch-data', async (event, branchCode) => {
  try {
    excelManager.setBranchPath(branchCode);
    const success = await excelManager.loadBranchData(branchCode);
    if (!success) return { success: false, message: 'Failed to load branch' };
    return {
      success: true,
      data: {
        branchDetails: inMemoryData.branchDetails,
        products: inMemoryData.products,
        offers: inMemoryData.offers,
        categories: inMemoryData.categories
      }
    };
  } catch (e) {
    console.error('get-branch-data error:', e);
    return { success: false, message: 'Error loading branch' };
  }
});

ipcMain.handle('save-products-for-branch', async (event, { branchCode, products }) => {
  try {
    excelManager.setBranchPath(branchCode);
    // Load all branch data and preserve all sheets
    const loaded = await excelManager.loadBranchData(branchCode);
    if (!loaded) {
      return { success: false, message: 'Failed to load branch data' };
    }
    // Preserve all loaded sheets
    const preservedBranchDetails = inMemoryData.branchDetails ? { ...inMemoryData.branchDetails } : {};
    const preservedOffers = Array.isArray(inMemoryData.offers) ? [...inMemoryData.offers] : [];
    const preservedCategories = Array.isArray(inMemoryData.categories) ? [...inMemoryData.categories] : [];
    const preservedBills = Array.isArray(inMemoryData.bills) ? [...inMemoryData.bills] : [];
    const preservedBillItems = Array.isArray(inMemoryData.billItems) ? [...inMemoryData.billItems] : [];
    const preservedSettings = typeof inMemoryData.settings === 'object' ? { ...inMemoryData.settings } : {};
    if (!Array.isArray(products)) {
      console.error('Save products-for-branch called with non-array:', products);
      return { success: false, message: 'Invalid products data' };
    }
    if (products.length === 0) {
      console.warn('Attempt to save empty product list for branch', branchCode, '. Operation aborted.');
      return { success: false, message: 'Refusing to overwrite products with empty list.' };
    }
    inMemoryData.products = (products || []).map(p => ({ ...p, branch: branchCode }));
    // Restore preserved sheets
    inMemoryData.branchDetails = preservedBranchDetails;
    inMemoryData.offers = preservedOffers;
    inMemoryData.categories = preservedCategories;
    inMemoryData.bills = preservedBills;
    inMemoryData.billItems = preservedBillItems;
    inMemoryData.settings = preservedSettings;
    // Save all sheets, but only products is updated
    const success = await excelManager.saveBranchData();
    return { success };
  } catch (e) {
    console.error('save-products-for-branch error:', e);
    return { success: false, message: 'Failed to save products' };
  }
});

console.log(currentBranch);

ipcMain.handle('save-offers-for-branch', async (event, { branchCode, offers }) => {
  try {
    // Save offers to all branch Excel files, preserving all sheets
    const dataDir = path.join(__dirname, 'data');
    const files = fs.readdirSync(dataDir).filter(file => file.startsWith('branch_') && file.endsWith('.xlsx') && file !== 'branch_GLOBAL.xlsx');
    for (const file of files) {
      const branchCode = file.replace('branch_', '').replace('.xlsx', '');
      excelManager.setBranchPath(branchCode);
      const loaded = await excelManager.loadBranchData(branchCode);
      if (!loaded) continue;
      // Preserve all loaded sheets
      const preservedBranchDetails = inMemoryData.branchDetails ? { ...inMemoryData.branchDetails } : {};
      const preservedProducts = Array.isArray(inMemoryData.products) ? [...inMemoryData.products] : [];
      const preservedCategories = Array.isArray(inMemoryData.categories) ? [...inMemoryData.categories] : [];
      const preservedBills = Array.isArray(inMemoryData.bills) ? [...inMemoryData.bills] : [];
      const preservedBillItems = Array.isArray(inMemoryData.billItems) ? [...inMemoryData.billItems] : [];
      const preservedSettings = typeof inMemoryData.settings === 'object' ? { ...inMemoryData.settings } : {};
      inMemoryData.offers = offers || [];
      // Restore preserved sheets
      inMemoryData.branchDetails = preservedBranchDetails;
      inMemoryData.products = preservedProducts;
      inMemoryData.categories = preservedCategories;
      inMemoryData.bills = preservedBills;
      inMemoryData.billItems = preservedBillItems;
      inMemoryData.settings = preservedSettings;
      // Save all sheets, but only offers is updated
      await excelManager.saveBranchData();
    }
    // Delete branch_GLOBAL.xlsx if exists
    const globalPath = path.join(dataDir, 'branch_GLOBAL.xlsx');
    if (fs.existsSync(globalPath)) {
      fs.unlinkSync(globalPath);
    }
    return { success: true };
  } catch (e) {
    console.error('save-offers-for-branch error:', e);
    return { success: false, message: 'Failed to save offers to all branches' };
  }
});

ipcMain.handle('save-categories-to-all-branches', async (event, categories) => {
  try {
    // Save categories to all branch Excel files, preserving all sheets
    const dataDir = path.join(__dirname, 'data');
    const files = fs.readdirSync(dataDir).filter(file => file.startsWith('branch_') && file.endsWith('.xlsx'));
    for (const file of files) {
      const branchCode = file.replace('branch_', '').replace('.xlsx', '');
      excelManager.setBranchPath(branchCode);
      const loaded = await excelManager.loadBranchData(branchCode);
      if (!loaded) continue;
      // Preserve all loaded sheets
      const preservedBranchDetails = inMemoryData.branchDetails ? { ...inMemoryData.branchDetails } : {};
      const preservedProducts = Array.isArray(inMemoryData.products) ? [...inMemoryData.products] : [];
      const preservedOffers = Array.isArray(inMemoryData.offers) ? [...inMemoryData.offers] : [];
      const preservedBills = Array.isArray(inMemoryData.bills) ? [...inMemoryData.bills] : [];
      const preservedBillItems = Array.isArray(inMemoryData.billItems) ? [...inMemoryData.billItems] : [];
      const preservedSettings = typeof inMemoryData.settings === 'object' ? { ...inMemoryData.settings } : {};
      inMemoryData.categories = categories || [];
      // Restore preserved sheets
      inMemoryData.branchDetails = preservedBranchDetails;
      inMemoryData.products = preservedProducts;
      inMemoryData.offers = preservedOffers;
      inMemoryData.bills = preservedBills;
      inMemoryData.billItems = preservedBillItems;
      inMemoryData.settings = preservedSettings;
      // Save all sheets, but only categories is updated
      await excelManager.saveBranchData();
    }
    return { success: true };
  } catch (e) {
    console.error('save-categories-to-all-branches error:', e);
    return { success: false, message: 'Failed to save categories to all branches' };
  }
});

ipcMain.handle('save-branch-details-for-branch', async (event, { branchCode, details }) => {
  try {
    excelManager.setBranchPath(branchCode);
    // Load all branch data and preserve all sheets
    const loaded = await excelManager.loadBranchData(branchCode);
    if (!loaded) {
      return { success: false, message: 'Failed to load branch data' };
    }
    // Preserve all loaded sheets
    const preservedProducts = Array.isArray(inMemoryData.products) ? [...inMemoryData.products] : [];
    const preservedOffers = Array.isArray(inMemoryData.offers) ? [...inMemoryData.offers] : [];
    const preservedCategories = Array.isArray(inMemoryData.categories) ? [...inMemoryData.categories] : [];
    const preservedBills = Array.isArray(inMemoryData.bills) ? [...inMemoryData.bills] : [];
    const preservedBillItems = Array.isArray(inMemoryData.billItems) ? [...inMemoryData.billItems] : [];
    const preservedSettings = typeof inMemoryData.settings === 'object' ? { ...inMemoryData.settings } : {};
    // Merge only branch details
    const merged = { ...(inMemoryData.branchDetails || {}), ...(details || {}) };
    if (details && details.password) {
      merged.password = details.password;
    }
    inMemoryData.branchDetails = merged;
    // Restore preserved sheets
    inMemoryData.products = preservedProducts;
    inMemoryData.offers = preservedOffers;
    inMemoryData.categories = preservedCategories;
    inMemoryData.bills = preservedBills;
    inMemoryData.billItems = preservedBillItems;
    inMemoryData.settings = preservedSettings;
    // Save all sheets, but only branch details is updated
    const success = await excelManager.saveBranchData();
    return { success };
  } catch (e) {
    console.error('save-branch-details-for-branch error:', e);
    return { success: false, message: 'Failed to save branch details' };
  }
});

ipcMain.handle('save-branch-details', async (event, branchDetails) => {
  try {
    // Merge and hash password if provided as plain text
    if (!inMemoryData.branchDetails) inMemoryData.branchDetails = {};
    const merged = { ...inMemoryData.branchDetails, ...branchDetails };

    if (branchDetails && branchDetails.password) {
      merged.password = branchDetails.password;
    }

    inMemoryData.branchDetails = merged;
    const success = await excelManager.saveBranchData();
    return { success };
  } catch (error) {
    console.error('Save branch details error:', error);
    return { success: false, message: 'Failed to save branch details' };
  }
});

ipcMain.handle('save-categories', async (event, categories) => {
  try {
    if (!Array.isArray(categories)) {
      console.error('Save categories called with non-array:', categories);
      return { success: false, message: 'Invalid categories data' };
    }
    if (categories.length === 0) {
      console.warn('Attempt to save empty categories list. Operation aborted.');
      return { success: false, message: 'Refusing to overwrite categories with empty list.' };
    }
    inMemoryData.categories = categories;
    console.log('Saving categories:', JSON.stringify(categories, null, 2));
    const success = await excelManager.saveBranchData();
    return { success };
  } catch (error) {
    console.error('Save categories error:', error);
    return { success: false, message: 'Failed to save categories' };
  }
});

ipcMain.handle('create-bill', async (event, billData) => {
  try {
    // Ensure branch file path is set before saving bill
    if (!currentBranch && billData.branchDetails && billData.branchDetails.branch_code) {
      currentBranch = billData.branchDetails.branch_code;
    }
    if (currentBranch) {
      excelManager.setBranchPath(currentBranch);
      // Reload branch data to preserve previous bills
      await excelManager.loadBranchData(currentBranch);
    }
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    if (!billData || (Array.isArray(billData.items) && billData.items.length === 0)) {
      console.warn('Attempt to create bill with empty items. Operation aborted.');
      return { success: false, message: 'Cannot create bill with no items.' };
    }
    // Assign bill_no: max for today + 1, or 1 if none
    const todaysBills = inMemoryData.bills.filter(b => b.date_iso === today);
    const billNo = todaysBills.length === 0 ? 1 : Math.max(...todaysBills.map(b => b.bill_no || 0)) + 1;
    const bill = {
      ...billData,
      bill_no: billNo,
      date_iso: today,
      created_at_ts: new Date().toISOString(),
      total: billData.total
    };
    inMemoryData.bills.push(bill);
    // Add bill items
    if (Array.isArray(billData.items)) {
      billData.items.forEach(item => {
        inMemoryData.billItems.push({
          ...item,
          bill_no: billNo,
          date_iso: today
        });
      });
    }
    // Filter bills and billItems for today and yesterday only before saving
    inMemoryData.bills = inMemoryData.bills.filter(b => b.date_iso === today || b.date_iso === yesterday);
    inMemoryData.billItems = inMemoryData.billItems.filter(item => item.date_iso === today || item.date_iso === yesterday);
    console.log('Creating bill:', JSON.stringify(bill, null, 2));
    await excelManager.saveBranchData();
    return { success: true, billNo };
  } catch (error) {
    console.error('Create bill error:', error);
    return { success: false, message: 'Failed to create bill' };
  }
});

ipcMain.handle('print-bill', async (event, billNo) => {
  try {
    const bill = inMemoryData.bills.find(b => b.bill_no === billNo);
    
    if (!bill) {
      return { success: false, message: 'Bill not found' };
    }
    
    if (bill.printed === 1) {
      return { success: false, message: 'Already printed' };
    }
    
    // Mark as printed
    bill.printed = 1;
    await excelManager.saveBranchData();
    
    // Get the appropriate window for printing
    const targetWindow = userWindow || mainWindow;
    if (targetWindow) {
      await targetWindow.webContents.print({
        silent: true,
        printBackground: true,
        copies: 1
      });
    }
    
    return { success: true };
  } catch (error) {
    console.error('Print bill error:', error);
    return { success: false, message: 'Print failed' };
  }
});

ipcMain.handle('get-reports', async (event, filter) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const targetDate = filter === 'yesterday' ? yesterday : today;
    
    const targetBills = inMemoryData.bills.filter(bill => bill.date_iso === targetDate);
    const targetBillItems = inMemoryData.billItems.filter(item => 
      targetBills.some(bill => bill.bill_no === item.bill_no)
    );
    
    // Item-wise report
    const itemWiseReport = {};
    let itemWiseTotalQty = 0, itemWiseTotalAmount = 0;
    targetBillItems.forEach(item => {
      const product = inMemoryData.products.find(p => p.product_id === item.product_id);
      if (product) {
        if (!itemWiseReport[product.product_id]) {
          itemWiseReport[product.product_id] = {
            name: product.name,
            qty: 0,
            total: 0
          };
        }
        itemWiseReport[product.product_id].qty += item.qty;
        itemWiseReport[product.product_id].total += item.total;
        itemWiseTotalQty += item.qty;
        itemWiseTotalAmount += item.total;
      }
    });
    
    // Bill-wise report (include items)
    const billWiseReport = targetBills.map(bill => {
      const items = inMemoryData.billItems.filter(item => item.bill_no === bill.bill_no);
      console.log(items);
      return {
        bill_no: bill.bill_no,
        total: bill.total,
        time: bill.created_at_ts,
        items: items,
        cgst: bill.cgst || 0,
        sgst: bill.sgst || 0
      };
    });
    
    // Day-wise summary
    const dayWiseSummary = {
      date: targetDate,
      total_bills: targetBills.length,
      total_qty: targetBillItems.reduce((sum, item) => sum + item.qty, 0),
      total_sales: targetBills.reduce((sum, bill) => sum + bill.total, 0),
      cgst: targetBills.reduce((sum, bill) => sum + (bill.cgst || 0), 0),
      sgst: targetBills.reduce((sum, bill) => sum + (bill.sgst || 0), 0)
    };
    
    return {
      success: true,
      data: {
        itemWise: Object.values(itemWiseReport),
        itemWiseTotal: { qty: itemWiseTotalQty, total: itemWiseTotalAmount },
        billWise: billWiseReport,
        dayWise: dayWiseSummary,
        branchDetails: inMemoryData.branchDetails
      }
    };
  } catch (error) {
    console.error('Get reports error:', error);
    return { success: false, message: 'Failed to generate reports' };
  }
});

ipcMain.handle('push-sync', async (event) => {
  try {
    const auth = getOAuth2Client();
    if (!auth) throw new Error('No OAuth2 client available');
    const drive = google.drive({ version: 'v3', auth });
    const dataDir = path.join(__dirname, 'data');
    const files = fs.readdirSync(dataDir).filter(file => file.startsWith('branch_') && file.endsWith('.xlsx'));
    let allBranchData = [];
    for (const file of files) {
      const branchCode = file.replace('branch_', '').replace('.xlsx', '');
      excelManager.setBranchPath(branchCode);
      const loaded = await excelManager.loadBranchData(branchCode);
      if (!loaded) continue;
      const manifest = {
        version: inMemoryData.settings.version || '1.0.0',
        timestamp: new Date().toISOString(),
        branch_code: branchCode
      };
      const packageData = {
        manifest,
        branch_details: inMemoryData.branchDetails,
        products: inMemoryData.products,
        offers: inMemoryData.offers,
        categories: inMemoryData.categories
      };
      // Prepare buffer and stream
      const payload = JSON.stringify(packageData);
      const stream = require('stream');
      const buf = Buffer.from(payload);
      const rs = new stream.PassThrough();
      rs.end(buf);
      // Upload to Google Drive
      const fileName = `branch_${branchCode}_package_v${manifest.version}.json`;
      await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [DRIVE_FOLDER_ID],
          mimeType: 'application/json'
        },
        media: {
          mimeType: 'application/json',
          body: rs
        }
      });
      // Update last sync timestamp
      inMemoryData.branchDetails.last_sync_ts = new Date().toISOString();
      await excelManager.saveBranchData();
      allBranchData.push(packageData);
    }
    return {
      success: true,
      message: 'Sync packages pushed to Google Drive for all branches.',
      data: allBranchData
    };
  } catch (error) {
    console.error('Push sync error:', error);
    return { success: false, message: 'Sync failed: ' + error.message };
  }
});

ipcMain.handle('pull-sync', async (event) => {
  try {
    const auth = getOAuth2Client();
    if (!auth) throw new Error('No OAuth2 client available');
    const drive = google.drive({ version: 'v3', auth });
    const dataDir = path.join(__dirname, 'data');
    const files = fs.readdirSync(dataDir).filter(file => file.startsWith('branch_') && file.endsWith('.xlsx'));
    let allBranchData = [];
    for (const file of files) {
      const branchCode = file.replace('branch_', '').replace('.xlsx', '');
      // Find latest sync package for this branch
      const q = `('${DRIVE_FOLDER_ID}' in parents) and name contains 'branch_${branchCode}_package_' and mimeType='application/json'`;
      const listRes = await drive.files.list({
        q,
        orderBy: 'modifiedTime desc',
        pageSize: 1,
        fields: 'files(id,name,modifiedTime)'
      });
      if (!listRes.data.files || listRes.data.files.length === 0) {
        console.warn(`No sync package found for branch ${branchCode}`);
        continue;
      }
      const fileId = listRes.data.files[0].id;
      // Download the file
      const getRes = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
      let data = '';
      await new Promise((resolve, reject) => {
        getRes.data.on('data', chunk => { data += chunk; });
        getRes.data.on('end', resolve);
        getRes.data.on('error', reject);
      });
      const packageData = JSON.parse(data);
      // Validate manifest, update inMemoryData
      if (!packageData.manifest || !packageData.branch_details) {
        console.warn(`Invalid sync package for branch ${branchCode}`);
        continue;
      }
      excelManager.setBranchPath(branchCode);
      await excelManager.loadBranchData(branchCode);
      inMemoryData.branchDetails = packageData.branch_details;
      inMemoryData.products = packageData.products || [];
      inMemoryData.offers = packageData.offers || [];
      inMemoryData.categories = packageData.categories || [];
      // DO NOT touch bills/bill_items
      await excelManager.saveBranchData();
      allBranchData.push(packageData);
    }
    return {
      success: true,
      message: 'Sync packages pulled from Google Drive for all branches.',
      data: allBranchData
    };
  } catch (error) {
    console.error('Pull sync error:', error);
    return { success: false, message: 'Pull sync failed: ' + error.message };
  }
});

// Window creation functions
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createAdminWindow() {
  adminWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  adminWindow.loadFile('admin.html');
  adminWindow.on('closed', () => {
    adminWindow = null;
  });
}

function createUserWindow() {
  userWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  userWindow.loadFile('user.html');
  userWindow.on('closed', () => {
    userWindow = null;
  });
}

// App event handlers
app.whenReady().then(() => {
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// Export functions for renderer (kept for compatibility but not used in single window mode)
ipcMain.handle('open-admin-window', () => {
  // Single window mode - navigation handled by window.location.href
  return { success: true };
});

ipcMain.handle('open-user-window', () => {
  // Single window mode - navigation handled by window.location.href
  return { success: true };
});

ipcMain.handle('close-window', (event, windowType) => {
  // Single window mode - logout handled by window.location.href
  return { success: true };
});

// Expose currentBranch to renderer via IPC
ipcMain.handle('get-current-branch', async () => {
  return currentBranch;
});
