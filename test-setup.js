// Test script to verify the POS Billing System setup
const fs = require('fs');
const path = require('path');

console.log('POS Billing System - Setup Test');
console.log('================================');

// Check if required files exist
const requiredFiles = [
  'main.js',
  'preload.js',
  'package.json',
  'index.html',
  'admin.html',
  'user.html',
  'renderer/login.js',
  'renderer/admin.js',
  'renderer/user.js'
];

console.log('\nChecking required files...');
let allFilesExist = true;

requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`✓ ${file}`);
  } else {
    console.log(`✗ ${file} - MISSING`);
    allFilesExist = false;
  }
});

// Check if directories exist
const requiredDirs = ['data', 'templates', 'assets', 'renderer'];

console.log('\nChecking required directories...');
requiredDirs.forEach(dir => {
  if (fs.existsSync(dir)) {
    console.log(`✓ ${dir}/`);
  } else {
    console.log(`✗ ${dir}/ - MISSING`);
    allFilesExist = false;
  }
});

// Check package.json dependencies
console.log('\nChecking package.json...');
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  const requiredDeps = ['electron', 'xlsx', 'bcrypt', 'googleapis', 'archiver', 'unzipper'];
  const requiredDevDeps = ['electron-builder'];
  
  console.log('Dependencies:');
  requiredDeps.forEach(dep => {
    if (packageJson.dependencies && packageJson.dependencies[dep]) {
      console.log(`✓ ${dep}: ${packageJson.dependencies[dep]}`);
    } else {
      console.log(`✗ ${dep} - MISSING`);
      allFilesExist = false;
    }
  });
  
  console.log('Dev Dependencies:');
  requiredDevDeps.forEach(dep => {
    if (packageJson.devDependencies && packageJson.devDependencies[dep]) {
      console.log(`✓ ${dep}: ${packageJson.devDependencies[dep]}`);
    } else {
      console.log(`✗ ${dep} - MISSING`);
      allFilesExist = false;
    }
  });
  
} catch (error) {
  console.log('✗ Error reading package.json:', error.message);
  allFilesExist = false;
}

console.log('\n================================');
if (allFilesExist) {
  console.log('✓ Setup test PASSED - All required files and dependencies are present');
  console.log('\nNext steps:');
  console.log('1. Run: npm install');
  console.log('2. Run: npm start (for development)');
  console.log('3. Run: npm run build-win (to build executable)');
} else {
  console.log('✗ Setup test FAILED - Some files or dependencies are missing');
  console.log('Please check the missing items above and fix them before proceeding');
}

console.log('\nDefault login credentials:');
console.log('Admin: username=admin, password=admin123');
console.log('User: username=user, password=user123');
