process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const bcrypt = require('bcrypt');
const axios = require('axios');

app.commandLine.appendSwitch('disable-gpu');

// Get persistent user data directory for Excel files
let userDataDir;
let logFilePath;
function logToFile(...args) {
  if (!logFilePath) return;
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
  fs.appendFileSync(logFilePath, `[${new Date().toISOString()}] ${msg}\n`);
}

// Global variables
// Backend API config
const BACKEND_API_URL = 'https://billing3-backend.onrender.com'; // Updated to Render.com backend URL



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
// Utility functions for robust Excel file management
function getBranchFile(userDataDir, branchId) {
  const dataDir = path.join(userDataDir, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, `branch_${branchId}.xlsx`);
}

function getTemplateFile(branchId) {
  // Template location can be in templates/ or userDataDir/data (fallback)
  const templatePath = path.join(__dirname, 'templates', `branch_${branchId}.xlsx`);
  if (fs.existsSync(templatePath)) return templatePath;
  if (typeof userDataDir !== 'undefined' && userDataDir) {
    const fallbackPath = path.join(userDataDir, 'data', `branch_${branchId}.xlsx`);
    if (fs.existsSync(fallbackPath)) return fallbackPath;
  }
  return null;
}

function ensureBranchFile(userDataDir, branchId) {
  const branchFile = getBranchFile(userDataDir, branchId);
  if (!fs.existsSync(branchFile)) {
    // Try to copy template if available
    const templateFile = getTemplateFile(branchId);
    if (templateFile) {
      fs.copyFileSync(templateFile, branchFile);
    } else {
      // Create empty Excel file with required sheets
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'branch_details');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'products');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'offers');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'categories');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'bills');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([]), 'bill_items');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
        { key: 'lastCleanupDate', value: new Date().toISOString().split('T')[0] },
        { key: 'version', value: '1.0.0' }
      ]), 'settings');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
        { username: 'admin', password: 'admin123', role: 'admin' },
        { username: 'user', password: 'user123', role: 'user' }
      ]), 'users');
      XLSX.writeFile(workbook, branchFile);
    }
  }
  return branchFile;
}

function readExcel(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return XLSX.readFile(filePath);
}

function updateExcel(filePath, sheetName, data) {
  let workbook = fs.existsSync(filePath) ? XLSX.readFile(filePath) : XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  XLSX.writeFile(workbook, filePath);
}

class ExcelManager {
  constructor(userDataDir) {
    this.userDataDir = userDataDir;
    this.branchFilePath = null;
  }

  setBranchPath(branchCode) {
    this.branchFilePath = ensureBranchFile(this.userDataDir, branchCode);
  }

  async loadBranchData(branchCode) {
    logToFile('[DEBUG] Loading Excel file:', this.branchFilePath);
    if (!this.branchFilePath || !fs.existsSync(this.branchFilePath)) {
      this.branchFilePath = ensureBranchFile(this.userDataDir, branchCode);
    }
    try {
      const workbook = readExcel(this.branchFilePath);
      logToFile('[DEBUG] workbook:', workbook);
      // Load branch details
      if (workbook.Sheets['branch_details']) {
        const branchData = XLSX.utils.sheet_to_json(workbook.Sheets['branch_details']);
        inMemoryData.branchDetails = branchData[0] || {};
        logToFile('[DEBUG] Loaded branchDetails:', inMemoryData.branchDetails);
      }
      // Load products
      if (workbook.Sheets['products']) {
        let allProducts = XLSX.utils.sheet_to_json(workbook.Sheets['products']);
        // Ensure discount field is present and numeric for all products
        allProducts.forEach(p => {
          if (p.discount === undefined || p.discount === null || isNaN(Number(p.discount))) {
            p.discount = 0;
          } else {
            p.discount = Number(p.discount);
          }
        });
        inMemoryData.products = allProducts.filter(p => p.branch === branchCode);
        logToFile('[DEBUG] Loaded products:', inMemoryData.products);
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
      // Custom day boundary: 5 am
      function getDayBoundary(date) {
        // Returns the date string for the 5am boundary of the given date
        const d = new Date(date);
        if (d.getHours() < 5) {
          // Before 5am, treat as previous day
          d.setDate(d.getDate() - 1);
        }
        d.setHours(5, 0, 0, 0);
        return d.toISOString().split('T')[0];
      }
      const now = new Date();
      const todayBoundary = getDayBoundary(now);
      const yesterdayBoundary = getDayBoundary(new Date(now.getTime() - 24 * 60 * 60 * 1000));
      // Load bills (only today and yesterday by 5am boundary)
      if (workbook.Sheets['bills']) {
        const allBills = XLSX.utils.sheet_to_json(workbook.Sheets['bills']);
        inMemoryData.bills = allBills.filter(bill =>
          bill.day_boundary === todayBoundary || bill.day_boundary === yesterdayBoundary
        );
        console.log('[DEBUG] inMemoryData.bills after filter:', inMemoryData.bills);
      }
      // Load bill items (only for today and yesterday by 5am boundary)
      if (workbook.Sheets['bill_items']) {
        const allBillItems = XLSX.utils.sheet_to_json(workbook.Sheets['bill_items']);
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
      logToFile('Error loading branch data:', error);
      return false;
    }
  }

  async createNewBranchFile() {
    // Always use ensureBranchFile to create the file
    if (!this.branchFilePath) return false;
    ensureBranchFile(this.userDataDir, currentBranch);
    return true;
  }

  async saveBranchData() {
    if (!this.branchFilePath) return false;

    try {
      const workbook = XLSX.utils.book_new();
      logToFile('DEBUG: Bills to be saved in Excel:', JSON.stringify(inMemoryData.bills, null, 2));

      // Save branch details
      const branchSheet = XLSX.utils.json_to_sheet([inMemoryData.branchDetails]);
      XLSX.utils.book_append_sheet(workbook, branchSheet, 'branch_details');

      // Save products
      let productsToSave = inMemoryData.products.map(p => ({
        ...p,
        discount: p.discount !== undefined && !isNaN(Number(p.discount)) ? Number(p.discount) : 0
      }));
      // If products is empty, preserve existing products sheet
      if ((!productsToSave || productsToSave.length === 0) && fs.existsSync(this.branchFilePath)) {
        try {
          const existingWorkbook = XLSX.readFile(this.branchFilePath);
          if (existingWorkbook.Sheets['products']) {
            productsToSave = XLSX.utils.sheet_to_json(existingWorkbook.Sheets['products']);
          }
        } catch (err) {
          logToFile('Error preserving products sheet:', err);
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
      logToFile('Error saving branch data:', error);
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
    // Use 5am boundary for bill numbering
    function getDayBoundary(date) {
      const d = new Date(date);
      if (d.getHours() < 5) {
        d.setDate(d.getDate() - 1);
      }
      d.setHours(5, 0, 0, 0);
      return d.toISOString().split('T')[0];
    }
    const now = new Date();
    const todayBoundary = getDayBoundary(now);
    const todayBills = inMemoryData.bills.filter(bill => bill.day_boundary === todayBoundary);
    if (todayBills.length === 0) {
      return 1;
    }
    const maxBillNo = Math.max(...todayBills.map(bill => bill.bill_no));
    return maxBillNo + 1;
  }
}

let excelManager;

// IPC Handlers

// Print bill HTML in hidden window
ipcMain.handle('print-bill-html', async (event, billHtml) => {
  try {
    const printWin = new BrowserWindow({
      show: false,
      width: 400,
      height: 1200,
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
  // Add print CSS for 100mm x 297mm thermal bill size
  const printCss = `@page { size: 100mm 297mm; margin: 0; } body { width: 95mm; min-height: 297mm; margin: 0; }`;
    const fullHtml = `<!DOCTYPE html>
    <html>
    <head>
      <meta charset='utf-8'>
      <title>Bill Print</title>
      <style>${userCss}</style>
      <style>${printCss}</style>
    </head>
    <body>${billHtml}</body>
    </html>`;
    printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml));
    printWin.webContents.on('did-finish-load', () => {
      try {
        printWin.webContents.print({
          silent: true,
          printBackground: true,
          copies: 1,
          pageSize: { width: 100000, height: 297000 } // 100mm x 297mm in microns
        }, (success, errorType) => {
          if (success) {
            console.log('Print job completed successfully');
          } else {
            console.error('Print job failed:', errorType);
          }
          setTimeout(() => { printWin.close(); }, 2000);
        });
      } catch (err) {
        console.error('Error during print:', err);
      }
    });
    return { success: true };
  } catch (error) {
    console.error('Print bill HTML error:', error);
    return { success: false, message: 'Print failed' };
  }
});

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
    // Find branch by password using userDataDir/data
    const dataDir = path.join(userDataDir, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const files = fs.readdirSync(dataDir).filter(file => file.startsWith('branch_') && file.endsWith('.xlsx'));
    let foundLocal = false;
    for (const file of files) {
      const branchCode = file.replace('branch_', '').replace('.xlsx', '');
      const filePath = getBranchFile(userDataDir, branchCode);
      try {
        const workbook = readExcel(filePath);
        if (workbook && workbook.Sheets['branch_details']) {
          const branchData = XLSX.utils.sheet_to_json(workbook.Sheets['branch_details']);
          const branch = branchData[0];
          if (branch && branch.password && branchPassword === branch.password) {
            // Load branch data
            currentBranch = branchCode;
            console.log('[AUTH] Set currentBranch:', currentBranch);
            excelManager.setBranchPath(branchCode);
            const success = await excelManager.loadBranchData(branchCode);
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
            foundLocal = true;
            break;
          }
        }
      } catch (error) {
        console.log(`Error reading ${file}:`, error.message);
        continue;
      }
    }
    // If not found locally, query backend
    if (!foundLocal) {
      try {
        // Call backend API to find branch by password
        const res = await axios.post(`${BACKEND_API_URL}/sync/find-branch-by-password`, { password: branchPassword });
        if (res.data && res.data.branchCode && res.data.fileBuffer) {
          const branchCode = res.data.branchCode;
          const filePath = getBranchFile(userDataDir, branchCode);
          // Defensive: handle fileBuffer as base64 string or Buffer
          let fileBuffer = res.data.fileBuffer;
          if (!fileBuffer) {
            console.error('[SYNC] Backend response missing fileBuffer:', res.data);
            return { success: false, message: 'Backend did not return branch file.' };
          }
          // If fileBuffer is a base64 string, decode it
          let bufferToWrite;
          if (typeof fileBuffer === 'string') {
            try {
              bufferToWrite = Buffer.from(fileBuffer, 'base64');
            } catch (err) {
              console.error('[SYNC] Failed to decode base64 fileBuffer:', err);
              return { success: false, message: 'Failed to decode branch file from backend.' };
            }
          } else if (fileBuffer.data) {
            bufferToWrite = Buffer.from(fileBuffer.data);
          } else if (Buffer.isBuffer(fileBuffer)) {
            bufferToWrite = fileBuffer;
          } else {
            console.error('[SYNC] Unknown fileBuffer format:', fileBuffer);
            return { success: false, message: 'Unknown branch file format from backend.' };
          }
          // Save Excel file from backend
          fs.writeFileSync(filePath, bufferToWrite);          // Load branch data
          currentBranch = branchCode;
          excelManager.setBranchPath(branchCode);
          const success = await excelManager.loadBranchData(branchCode);
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
        return { success: false, message: 'Invalid branch password or branch not found in backend.' };
      } catch (error) {
        console.error('Backend branch lookup error:', error);
        return { success: false, message: 'Backend error: ' + error.message };
      }
    }
  } catch (error) {
    console.error('User authentication error:', error);
    return { success: false, message: 'Authentication failed' };
  }
});

ipcMain.handle('load-branch-file', async (event, branchCode) => {
  try {
    currentBranch = branchCode;
    console.log('[LOAD] Set currentBranch:', currentBranch);
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
    const dataDir = path.join(userDataDir, 'data');
    if (!fs.existsSync(dataDir)) {
      return { success: true, branches: [] };
    }
    const files = fs.readdirSync(dataDir).filter(file => file.startsWith('branch_') && file.endsWith('.xlsx'));
    const branches = [];
    for (const file of files) {
      const branchCode = file.replace('branch_', '').replace('.xlsx', '');
      const filePath = getBranchFile(userDataDir, branchCode);
      try {
        const workbook = readExcel(filePath);
        if (workbook && workbook.Sheets['branch_details']) {
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
    const filePath = getBranchFile(userDataDir, branch_code);
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
    // Save user-entered branch details to Excel file
    const saved = await excelManager.saveBranchData();
    if (success && saved) {
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
    const filePath = getBranchFile(userDataDir, branchCode);
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
    const dataDir = path.join(userDataDir, 'data');
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
    const dataDir = path.join(userDataDir, 'data');
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
    // Use 5am boundary for bill creation
    function getDayBoundary(date) {
      const d = new Date(date);
      if (d.getHours() < 5) {
        d.setDate(d.getDate() - 1);
      }
      d.setHours(5, 0, 0, 0);
      return d.toISOString().split('T')[0];
    }
    const now = new Date();
    const todayBoundary = getDayBoundary(now);
    const yesterdayBoundary = getDayBoundary(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    if (!billData || (Array.isArray(billData.items) && billData.items.length === 0)) {
      console.warn('Attempt to create bill with empty items. Operation aborted.');
      return { success: false, message: 'Cannot create bill with no items.' };
    }
    // Assign bill_no: max for today + 1, or 1 if none
    const todaysBills = inMemoryData.bills.filter(b => b.day_boundary === todayBoundary);
    const billNo = todaysBills.length === 0 ? 1 : Math.max(...todaysBills.map(b => b.bill_no || 0)) + 1;
    // Apply round off if enabled
    const globalSettings = loadGlobalSettings();
    let billTotal = billData.total;
    if (globalSettings && globalSettings.roundOff && typeof billTotal === 'number') {
      billTotal = Math.round(billTotal);
    }
    const bill = {
      ...billData,
      bill_no: billNo,
      date_iso: now.toISOString().split('T')[0],
      created_at_ts: now.toISOString(),
      day_boundary: todayBoundary,
      total: billTotal
    };
    inMemoryData.bills.push(bill);
    // Add bill items
    if (Array.isArray(billData.items)) {
      billData.items.forEach(item => {
        inMemoryData.billItems.push({
          ...item,
          bill_no: billNo,
          date_iso: now.toISOString().split('T')[0],
          day_boundary: todayBoundary
        });
      });
    }
    // Filter bills and billItems for today and yesterday only before saving
    inMemoryData.bills = inMemoryData.bills.filter(b => b.day_boundary === todayBoundary || b.day_boundary === yesterdayBoundary);
    inMemoryData.billItems = inMemoryData.billItems.filter(item => item.day_boundary === todayBoundary || item.day_boundary === yesterdayBoundary);
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
      return {
        bill_no: bill.bill_no,
        total: bill.total,
        time: bill.created_at_ts,
        billType: bill.billType || 'Takeaway',
        items: items,
        cgst: bill.cgst || 0,
        sgst: bill.sgst || 0
      };
    });

    // Count Takeaway and Home Delivery bills
    const takeawayCount = targetBills.filter(bill => bill.billType === 'Takeaway').length;
    const homeDeliveryCount = targetBills.filter(bill => bill.billType === 'Home Delivery').length;

    // Day-wise summary
    const dayWiseSummary = {
      date: targetDate,
      total_bills: targetBills.length,
      total_qty: targetBillItems.reduce((sum, item) => sum + item.qty, 0),
      total_sales: targetBills.reduce((sum, bill) => sum + bill.total, 0),
      cgst: targetBills.reduce((sum, bill) => sum + (bill.cgst || 0), 0),
      sgst: targetBills.reduce((sum, bill) => sum + (bill.sgst || 0), 0),
      takeaway_count: takeawayCount,
      home_delivery_count: homeDeliveryCount
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

// Admin: Sync (upload Excel to backend)
ipcMain.handle('push-sync', async (event) => {
  try {
    const dataDir = path.join(userDataDir, 'data');
    const files = fs.readdirSync(dataDir).filter(file => file.startsWith('branch_') && file.endsWith('.xlsx'));
    let allBranchData = [];
    for (const file of files) {
      const branchCode = file.replace('branch_', '').replace('.xlsx', '');
      excelManager.setBranchPath(branchCode);
      const loaded = await excelManager.loadBranchData(branchCode);
      if (!loaded) continue;
      // Upload Excel file to backend
      const filePath = excelManager.branchFilePath;
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('branch', branchCode); // Append branch first
      formData.append('file', fs.createReadStream(filePath));
      console.log('[SYNC] Uploading file for branch:', branchCode, '| currentBranch:', currentBranch);
      const res = await axios.post(`${BACKEND_API_URL}/sync/upload`, formData, {
        headers: formData.getHeaders()
      });
      // Update last sync timestamp
      inMemoryData.branchDetails.last_sync_ts = new Date().toISOString();
      await excelManager.saveBranchData();
      allBranchData.push({ branchCode, uploadResult: res.data });
    }
    return {
      success: true,
      message: 'Sync packages uploaded to backend for all branches.',
      data: allBranchData
    };
  } catch (error) {
    console.error('Push sync error:', error);
    return { success: false, message: 'Sync failed: ' + error.message };
  }
});

// User: Sync (download Excel from backend by branchId)
ipcMain.handle('pull-sync', async (event, branchId) => {
  try {
    const effectiveBranchId = branchId || currentBranch;
    console.log('[PULL] Requested branchId:', branchId, '| effectiveBranchId:', effectiveBranchId, '| currentBranch:', currentBranch);
    if (!effectiveBranchId) {
      throw new Error('No branchId provided and currentBranch is not set.');
    }
    // Ensure branchId is prefixed with 'branch_' for backend API
    const apiBranchParam = effectiveBranchId.startsWith('branch_') ? effectiveBranchId : `branch_${effectiveBranchId}`;
    // Download Excel file for current branch from backend
    const res = await axios.get(`${BACKEND_API_URL}/sync/download?branch=${apiBranchParam}`, { responseType: 'arraybuffer' });
    const fileBuffer = Buffer.from(res.data);
    // Save to local branch file, but preserve bills and bill_items
    excelManager.setBranchPath(effectiveBranchId);
    // Read local Excel file (if exists) to preserve bills and bill_items
    let localWorkbook = null;
    if (fs.existsSync(excelManager.branchFilePath)) {
      localWorkbook = XLSX.readFile(excelManager.branchFilePath);
    }
    // Read backend workbook from buffer
    const backendWorkbook = XLSX.read(fileBuffer, { type: 'buffer' });
    // Overwrite backend workbook's bills and bill_items sheets with local ones
    if (localWorkbook) {
      if (localWorkbook.Sheets['bills']) {
        backendWorkbook.Sheets['bills'] = localWorkbook.Sheets['bills'];
      }
      if (localWorkbook.Sheets['bill_items']) {
        backendWorkbook.Sheets['bill_items'] = localWorkbook.Sheets['bill_items'];
      }
    }
    // Write merged workbook to local file
    XLSX.writeFile(backendWorkbook, excelManager.branchFilePath);
    // Reload branch data
    await excelManager.loadBranchData(effectiveBranchId);
    // Update local database (categories, menu, offers, branch details)
    await excelManager.saveBranchData();
    return {
      success: true,
      message: 'Branch data synced from backend.',
      branchDetails: inMemoryData.branchDetails,
      products: inMemoryData.products,
      offers: inMemoryData.offers,
      categories: inMemoryData.categories
    };
  } catch (error) {
    console.error('Pull sync error:', error);
    return { success: false, message: 'Sync failed: ' + error.message };
  }
});

// Global settings file (for round off, etc)
const globalSettingsPath = path.join(userDataDir || app.getPath('userData'), 'global_settings.json');
function loadGlobalSettings() {
  try {
    if (fs.existsSync(globalSettingsPath)) {
      return JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    }
  } catch (e) {}
  return {};
}
function saveGlobalSettings(settings) {
  try {
    fs.writeFileSync(globalSettingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch (e) { return false; }
}

ipcMain.handle('get-global-settings', async () => {
  return loadGlobalSettings();
});
ipcMain.handle('save-global-settings', async (event, settings) => {
  const ok = saveGlobalSettings(settings);
  return { success: ok };
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
  // Initialize userDataDir and logFilePath after app is ready
  userDataDir = app.getPath('userData');
  logFilePath = path.join(userDataDir, 'main.log');
  excelManager = new ExcelManager(userDataDir);
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
