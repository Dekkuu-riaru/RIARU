require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// PostgreSQL connection
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'riaru',
  password: process.env.DB_PASSWORD || '1234',
  port: process.env.DB_PORT || 5432,
});

// Test connection
pool.connect((err) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
  } else {
    console.log('✅ Connected to PostgreSQL database: riaru');
  }
});

// ============== AUTH ROUTES ==============

// REGISTER
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  console.log('📝 Registration attempt:', { username, email }); // Debug log
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  
  try {
    // Check if user exists
    const existing = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email or username already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('🔑 Password hashed successfully');
    
    // Insert user
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role) 
       VALUES ($1, $2, $3, 'user') 
       RETURNING user_id, username, email, role`,
      [username, email, hashedPassword]
    );
    
    const user = result.rows[0];
    console.log('✅ User created:', user.user_id);
    
    // Create token
    const token = jwt.sign(
      { userId: user.user_id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    res.status(201).json({
      token,
      user: {
        userId: user.user_id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
    
  } catch (err) {
    console.error('❌ Registration error:', err);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  console.log('🔐 Login attempt:', { email }); // Debug log
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    // First, let's check if the users table exists and has data
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users'
      );
    `);
    console.log('📊 Users table exists:', tableCheck.rows[0].exists);
    
    if (!tableCheck.rows[0].exists) {
      return res.status(500).json({ error: 'Users table does not exist' });
    }
    
    // Get total user count
    const countResult = await pool.query('SELECT COUNT(*) FROM users');
    console.log('👥 Total users in database:', countResult.rows[0].count);
    
    // Find user by email
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    console.log('🔍 User query result rows:', result.rows.length);
    
    const user = result.rows[0];
    
    if (!user) {
      console.log('❌ User not found with email:', email);
      
      // List all emails in database for debugging (remove in production)
      const allUsers = await pool.query('SELECT email FROM users');
      console.log('📧 Available emails:', allUsers.rows.map(u => u.email));
      
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    console.log('✅ User found:', { id: user.user_id, username: user.username, email: user.email });
    console.log('📝 Stored password hash:', user.password_hash.substring(0, 20) + '...');
    
    // Compare password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    console.log('🔑 Password valid:', validPassword);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const token = jwt.sign(
      { userId: user.user_id, email: user.email, role: user.role || 'user' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    console.log('✅ Login successful for:', user.email);
    
    res.json({
      token,
      user: {
        userId: user.user_id,
        username: user.username,
        email: user.email,
        role: user.role || 'user'
      }
    });
    
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// TEST ROUTE - Create a test user directly (for debugging)
app.get('/api/create-test-user', async (req, res) => {
  try {
    const testEmail = 'test@email.com';
    const testUsername = 'testuser';
    const testPassword = 'password123';
    
    // Delete existing test user
    await pool.query('DELETE FROM users WHERE email = $1', [testEmail]);
    
    // Hash password
    const hashedPassword = await bcrypt.hash(testPassword, 10);
    
    // Create test user
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role) 
       VALUES ($1, $2, $3, 'user') 
       RETURNING user_id, username, email, role`,
      [testUsername, testEmail, hashedPassword]
    );
    
    const user = result.rows[0];
    
    res.json({
      message: 'Test user created',
      user: {
        email: user.email,
        username: user.username,
        password: testPassword // Only for debugging!
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CHECK USERS ROUTE - See all users (for debugging)
app.get('/api/check-users', async (req, res) => {
  try {
    const result = await pool.query('SELECT user_id, username, email, role FROM users');
    res.json({
      count: result.rows.length,
      users: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============== MANHWA ROUTES ==============

// Get all manhwa
app.get('/api/manhwa', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, 
        COALESCE(
          (SELECT json_agg(json_build_object(
            'source_id', s.source_id, 
            'source_name', s.source_name,
            'source_url', ms.source_url
          ))
           FROM manhwa_sources ms 
           JOIN sources s ON ms.source_id = s.source_id 
           WHERE ms.manhwa_id = m.manhwa_id), '[]'::json
        ) as sources
      FROM manhwa m
      ORDER BY m.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error:', err);
    res.json([]);
  }
});

// Get single manhwa
app.get('/api/manhwa/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, 
        COALESCE(
          (SELECT json_agg(json_build_object(
            'source_id', s.source_id, 
            'source_name', s.source_name,
            'source_url', ms.source_url
          ))
           FROM manhwa_sources ms 
           JOIN sources s ON ms.source_id = s.source_id 
           WHERE ms.manhwa_id = m.manhwa_id), '[]'::json
        ) as sources
      FROM manhwa m
      WHERE m.manhwa_id = $1
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Manhwa not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all sources
app.get('/api/sources', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sources ORDER BY source_name');
    res.json(result.rows);
  } catch (err) {
    res.json([]);
  }
});

// ============== BOOKMARK ROUTES ==============

// Get user bookmarks
app.get('/api/bookmarks/:userId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, m.title, m.cover_image, m.status
      FROM bookmarks b
      JOIN manhwa m ON b.manhwa_id = m.manhwa_id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC
    `, [req.params.userId]);
    
    res.json(result.rows);
  } catch (err) {
    res.json([]);
  }
});

// Add bookmark
app.post('/api/bookmarks', async (req, res) => {
  const { user_id, manhwa_id } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO bookmarks (user_id, manhwa_id) 
       VALUES ($1, $2) 
       RETURNING *`,
      [user_id, manhwa_id]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add bookmark' });
  }
});

// Remove bookmark
app.delete('/api/bookmarks/:userId/:manhwaId', async (req, res) => {
  const { userId, manhwaId } = req.params;
  
  try {
    await pool.query(
      'DELETE FROM bookmarks WHERE user_id = $1 AND manhwa_id = $2',
      [userId, manhwaId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove bookmark' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log('📝 Debug routes:');
  console.log('   - GET /api/check-users - See all users');
  console.log('   - GET /api/create-test-user - Create test user');
});