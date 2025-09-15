# POS Billing System

An offline-first Point of Sale (POS) desktop application built with Electron, using Excel files for persistent storage. The application is designed for small to medium businesses that need a reliable billing system without internet dependency.

## Features

### Core Functionality
- **Offline-first architecture** - Works without internet connection
- **Excel file storage** - Uses .xlsx files as the primary data store
- **Multi-branch support** - Each branch has its own Excel file
- **User authentication** - Admin and User roles with secure login
- **Numeric shortcuts** - Quick product addition using number keys
- **Bill generation and printing** - Single-print enforcement per bill
- **Comprehensive reporting** - Item-wise, bill-wise, and day-wise reports
- **Data synchronization** - Manual push/pull to Google Drive (stub implementation)

### Data Management
- **Auto-cleanup** - Removes bills older than 2 days automatically
- **Bill numbering** - Resets to 1 each day per branch
- **Product management** - Full CRUD operations for products and offers
- **Branch configuration** - Editable branch details, GST, FSSAI numbers

## Project Structure

```
billing3/
├── main.js                 # Main Electron process
├── preload.js             # Secure IPC communication
├── package.json           # Dependencies and build configuration
├── index.html             # Login page
├── admin.html             # Admin dashboard
├── user.html              # User POS interface
├── renderer/
│   ├── login.js           # Login functionality
│   ├── admin.js           # Admin interface logic
│   └── user.js            # User interface logic
├── data/                  # Excel files storage
├── templates/             # Template files
└── assets/                # Application assets
```

## Installation & Setup

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn

### Development Setup

1. **Clone and install dependencies:**
   ```bash
   cd billing3
   npm install
   ```

2. **Run in development mode:**
   ```bash
   npm run dev
   ```

3. **Build for production:**
   ```bash
   npm run build-win
   ```

### Building Standalone Executable

The application is configured to build a portable Windows .exe file:

```bash
npm run dist
```

This will create a portable executable in the `dist/` directory that includes all dependencies and can run on any Windows machine without requiring Node.js installation.

## Usage

### First Time Setup

1. **Launch the application** - Run the built .exe or use `npm start`
2. **Login** - Use default credentials:
   - Admin: username `admin`, password `admin123`
   - User: username `user`, password `user123`
3. **Select branch** - Enter a branch code (e.g., "BR001")
4. **Configure branch** - Admin can set branch details, add products, and configure offers

### Admin Functions

- **Branch Management**: Set branch name, GST number, FSSAI number, bill header
- **Product Management**: Add, edit, delete products with SKU, name, price, and shortcut numbers
- **Offer Management**: Create and manage discount offers
- **Data Sync**: Push updates to Google Drive for other devices to pull

### User Functions

- **POS Operations**: 
  - Use numeric shortcuts (type numbers + Enter) to add products
  - Search products by name or SKU
  - Manage quantities with +/- buttons
  - Generate and print bills
- **Reports**: Generate item-wise, bill-wise, and day-wise reports
- **Data Sync**: Pull updates from Google Drive

## Excel File Structure

Each branch uses a file named `branch_<branch_code>.xlsx` with these sheets:

### Sheets
1. **branch_details** - Branch information (code, name, GST, FSSAI, etc.)
2. **products** - Product catalog (ID, SKU, name, price, shortcut_number)
3. **offers** - Discount offers (ID, name, percentage, dates, active status)
4. **bills** - Bill records (bill_no, date, total, printed status)
5. **bill_items** - Bill line items (bill_no, product_id, quantity, price)
6. **settings** - Application settings (cleanup date, version)
7. **users** - User accounts (username, password_hash, role)

## Testing Checklist

### Basic Functionality
- [ ] Application launches successfully
- [ ] Login works with default credentials
- [ ] Branch selection creates new Excel file if not exists
- [ ] Admin and User interfaces open correctly

### Admin Testing
- [ ] Branch details can be edited and saved
- [ ] Products can be added with unique shortcut numbers
- [ ] Products can be edited inline and deleted
- [ ] Offers can be created with start/end dates
- [ ] Sync push functionality shows success message

### User Testing
- [ ] Numeric shortcuts work (type number + Enter)
- [ ] Search functionality finds products by name/SKU
- [ ] Products can be added to bill with quantity controls
- [ ] Bill generation creates unique bill numbers
- [ ] Print functionality works (single print enforcement)
- [ ] Reports generate correctly for Today/Yesterday
- [ ] Sync pull functionality shows success message

### Data Persistence
- [ ] Data persists between application restarts
- [ ] Bill numbering resets to 1 each day
- [ ] Old bills are cleaned up automatically
- [ ] Excel files are created in correct format

### Edge Cases
- [ ] Duplicate shortcut numbers are rejected
- [ ] Empty bills cannot be generated
- [ ] Already printed bills show "Already printed" message
- [ ] Invalid login shows appropriate error
- [ ] Missing branch files are handled gracefully

## Google Drive Integration

The application includes stub implementations for Google Drive sync. To enable full functionality:

1. **Set up Google Drive API:**
   - Create a project in Google Cloud Console
   - Enable Google Drive API
   - Create credentials (OAuth 2.0 or Service Account)
   - Download the credentials JSON file

2. **Configure in main.js:**
   - Replace the sync stub functions with actual Google Drive API calls
   - Add your credentials and folder ID
   - Implement proper error handling and retry logic

3. **Sync Process:**
   - **Push**: Admin uploads current data as a ZIP package
   - **Pull**: Users download and apply the latest data package
   - **Conflict Resolution**: Admin data is authoritative

## Security Considerations

- Passwords are hashed using bcrypt
- No sensitive data is stored in localStorage
- Excel files contain only necessary business data
- IPC communication is secured through preload script
- No nodeIntegration in renderer processes

## Troubleshooting

### Common Issues

1. **Excel file not found:**
   - Check if data directory exists
   - Verify branch code is correct
   - Ensure write permissions

2. **Print not working:**
   - Check printer is connected and default
   - Verify print permissions
   - Try different print options

3. **Sync issues:**
   - Verify Google Drive API credentials
   - Check network connectivity
   - Review console logs for errors

### Debug Mode

Run with debug logging:
```bash
npm run dev
```

Check console output for detailed error messages and data flow information.

## License

MIT License - See LICENSE file for details.

## Support

For issues and feature requests, please check the console logs and refer to this documentation. The application is designed to be self-contained and work offline, making it suitable for environments with limited internet connectivity.
