// ========== ЗАГРУЗКА ЗАВИСИМОСТЕЙ ==========
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ========== ИНИЦИАЛИЗАЦИЯ ==========
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'school-portal-secret-2024';
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend');

// ========== БАЗОВЫЕ НАСТРОЙКИ ==========
// Настройка CORS
app.use(cors({
    origin: [
        'https://school-portal-real.onrender.com',
        'http://localhost:3000',
        'http://localhost:5500'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Добавь обработку OPTIONS запросов
app.options('*', cors());
app.use(express.json());

// ========== ПОДКЛЮЧЕНИЕ БАЗЫ ДАННЫХ ==========
let db;
let isDatabaseConnected = false;

async function initializeDatabase() {
    try {
        const { Pool } = require('pg');
        db = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        // Проверка подключения
        await db.query('SELECT NOW()');
        console.log('✅ Database connected successfully');
        isDatabaseConnected = true;
        
        // Автоматическое создание таблиц при запуске
        await createTablesIfNotExist();
        
    } catch (error) {
        console.error('❌ Database connection error:', error.message);
        db = null;
        isDatabaseConnected = false;
    }
}

async function createTablesIfNotExist() {
    try {
        // Таблица пользователей
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                full_name VARCHAR(100) NOT NULL,
                role VARCHAR(20) DEFAULT 'teacher',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP
            )
        `);
        console.log('✅ Users table checked/created');
        
        // Таблица объявлений
        await db.query(`
            CREATE TABLE IF NOT EXISTS announcements (
                id SERIAL PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                content TEXT NOT NULL,
                category VARCHAR(50) DEFAULT 'all',
                type VARCHAR(50) DEFAULT 'announcement',
                author VARCHAR(100) NOT NULL,
                pinned BOOLEAN DEFAULT FALSE,
                urgent BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Announcements table checked/created');
        
        // Таблица расписания
        await db.query(`
            CREATE TABLE IF NOT EXISTS schedules (
                id SERIAL PRIMARY KEY,
                class_number INTEGER NOT NULL,
                class_letter VARCHAR(5) NOT NULL,
                day_of_week VARCHAR(20) NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                subject VARCHAR(100) NOT NULL,
                teacher VARCHAR(100) NOT NULL,
                room VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Schedules table checked/created');
        
    } catch (error) {
        console.error('❌ Error creating tables:', error.message);
    }
}

// Инициализируем базу данных при старте
initializeDatabase();

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
const requireAuth = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ 
                success: false, 
                error: 'Требуется авторизация' 
            });
        }
        
        const token = authHeader.replace('Bearer ', '');
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.id;
        req.userRole = decoded.role;
        next();
    } catch (error) {
        res.status(401).json({ 
            success: false, 
            error: 'Неверный токен' 
        });
    }
};

const checkDatabase = (req, res, next) => {
    if (!isDatabaseConnected || !db) {
        return res.status(503).json({
            success: false,
            error: 'База данных недоступна. Попробуйте позже.'
        });
    }
    next();
};

// ========== API МАРШРУТЫ ==========

// 1. ПРОВЕРКА СЕРВЕРА И БД
app.get('/api/health', async (req, res) => {
    try {
        let dbStatus = { connected: isDatabaseConnected };
        
        if (isDatabaseConnected && db) {
            try {
                const result = await db.query('SELECT NOW() as time');
                dbStatus.time = result.rows[0].time;
                
                // Проверяем существование таблиц
                const tables = await db.query(`
                    SELECT table_name 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public'
                `); 
                dbStatus.tables = tables.rows.map(row => row.table_name);
                
            } catch (dbError) {
                dbStatus.error = dbError.message;
            }
        } else {
            dbStatus.error = 'Database not connected';
        }
        
        res.json({
            success: true,
            status: 'OK',
            message: 'Сервер работает',
            timestamp: new Date().toISOString(),
            database: dbStatus,
            environment: process.env.NODE_ENV || 'development',
            port: PORT
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. ПРОВЕРКА НУЖЕН ЛИ ПЕРВЫЙ АДМИН
app.get('/api/setup/check', async (req, res) => {
    try {
        // Проверяем есть ли пользователи
        const result = await db.query('SELECT COUNT(*) as count FROM users');
        const count = parseInt(result.rows[0].count);
        
        res.json({
            success: true,
            needsSetup: count === 0,
            message: count === 0 ? 'Требуется создание первого администратора' : 'Система настроена',
            userCount: count
        });
    } catch (error) {
        console.error('Setup check error:', error);
        res.json({
            success: true,
            needsSetup: true,
            message: 'Проверьте настройку базы данных'
        });
    }
});

// 3. СОЗДАНИЕ ПЕРВОГО АДМИНА
app.post('/api/setup/first-admin', checkDatabase, async (req, res) => {
    try {
        const { username, password, full_name } = req.body;
        
        if (!username || !password || !full_name) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все поля'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен быть не менее 6 символов'
            });
        }
        
        // Проверяем есть ли уже пользователи
        const checkResult = await db.query('SELECT COUNT(*) as count FROM users');
        if (parseInt(checkResult.rows[0].count) > 0) {
            return res.status(400).json({
                success: false,
                error: 'Администратор уже создан'
            });
        }
        
        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Создаем первого админа
        const result = await db.query(
            `INSERT INTO users (username, password, full_name, role) 
             VALUES ($1, $2, $3, 'director') 
             RETURNING id, username, full_name, role, created_at`,
            [username, hashedPassword, full_name]
        );
        
        res.json({
            success: true,
            message: 'Первый администратор создан успешно',
            user: result.rows[0]
        });
        
    } catch (error) {
        console.error('First admin error:', error);
        
        // Если ошибка дублирования username
        if (error.code === '23505') {
            return res.status(400).json({
                success: false,
                error: 'Пользователь с таким логином уже существует'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера: ' + error.message
        });
    }
});

// 4. ВХОД В СИСТЕМУ
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Введите логин и пароль'
            });
        }
        
        const result = await db.query(
            'SELECT * FROM users WHERE username = $1',
            [username]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Неверный логин или пароль'
            });
        }
        
        const user = result.rows[0];
        
        // Проверяем пароль
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                error: 'Неверный логин или пароль'
            });
        }
        
        // Обновляем время последнего входа
        await db.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
            [user.id]
        );
        
        // Создаем JWT токен
        const token = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                role: user.role 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        // Убираем пароль из ответа
        const { password: _, ...userWithoutPassword } = user;
        
        res.json({
            success: true,
            token,
            user: userWithoutPassword,
            expiresIn: '24h'
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка входа: ' + error.message
        });
    }
});

// 5. ПОЛУЧИТЬ ВСЕ ОБЪЯВЛЕНИЯ
app.get('/api/announcements', checkDatabase, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC'
        );
        
        res.json({
            success: true,
            announcements: result.rows
        });
    } catch (error) {
        console.error('Get announcements error:', error);
        
        // Если таблицы нет, создаем ее и возвращаем пустой массив
        if (error.code === '42P01') {
            try {
                await createTablesIfNotExist();
                return res.json({
                    success: true,
                    announcements: []
                });
            } catch (createError) {
                return res.status(500).json({
                    success: false,
                    error: 'Ошибка инициализации базы данных'
                });
            }
        }
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения объявлений'
        });
    }
});

// 6. СОЗДАТЬ ОБЪЯВЛЕНИЕ
app.post('/api/announcements', checkDatabase, requireAuth, async (req, res) => {
    try {
        const { title, content, category, type, pinned, urgent } = req.body;
        
        if (!title || !content) {
            return res.status(400).json({
                success: false,
                error: 'Заполните заголовок и содержание'
            });
        }
        
        // Получаем пользователя для имени автора
        const userResult = await db.query(
            'SELECT full_name FROM users WHERE id = $1',
            [req.userId]
        );
        
        const author = userResult.rows[0]?.full_name || 'Администратор';
        
        const result = await db.query(
            `INSERT INTO announcements (title, content, category, type, author, pinned, urgent)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
                title.trim(),
                content.trim(),
                category || 'all',
                type || 'announcement',
                author,
                Boolean(pinned),
                Boolean(urgent)
            ]
        );
        
        res.json({
            success: true,
            announcement: result.rows[0]
        });
        
    } catch (error) {
        console.error('Create announcement error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания объявления'
        });
    }
});

// 7. ПОЛУЧИТЬ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ (админ)
app.get('/api/admin/users', checkDatabase, requireAuth, async (req, res) => {
    try {
        if (!['director', 'deputy'].includes(req.userRole)) {
            return res.status(403).json({
                success: false,
                error: 'Недостаточно прав'
            });
        }
        
        const result = await db.query(
            'SELECT id, username, full_name, role, created_at, last_login FROM users ORDER BY id'
        );
        
        res.json({
            success: true,
            users: result.rows
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения пользователей'
        });
    }
});

// 8. ПОЛУЧИТЬ РАСПИСАНИЕ
app.get('/api/schedules', checkDatabase, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT * FROM schedules 
             ORDER BY class_number, class_letter, 
             CASE day_of_week 
                 WHEN 'Понедельник' THEN 1
                 WHEN 'Вторник' THEN 2
                 WHEN 'Среда' THEN 3
                 WHEN 'Четверг' THEN 4
                 WHEN 'Пятница' THEN 5
                 WHEN 'Суббота' THEN 6
                 ELSE 7
             END, start_time`
        );
        
        res.json({
            success: true,
            schedules: result.rows
        });
    } catch (error) {
        console.error('Get schedules error:', error);
        
        // Если таблицы нет, создаем ее и возвращаем пустой массив
        if (error.code === '42P01') {
            try {
                await createTablesIfNotExist();
                return res.json({
                    success: true,
                    schedules: []
                });
            } catch (createError) {
                return res.status(500).json({
                    success: false,
                    error: 'Ошибка инициализации базы данных'
                });
            }
        }
        
        res.status(500).json({
            success: false,
            error: 'Ошибка получения расписания'
        });
    }
});

// 9. СОЗДАТЬ УРОК
app.post('/api/schedules', checkDatabase, requireAuth, async (req, res) => {
    try {
        const { class_number, class_letter, day_of_week, start_time, end_time, subject, teacher, room } = req.body;
        
        if (!class_number || !class_letter || !day_of_week || !start_time || !end_time || !subject || !teacher) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        const result = await db.query(
            `INSERT INTO schedules (class_number, class_letter, day_of_week, start_time, end_time, subject, teacher, room)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                parseInt(class_number),
                class_letter.trim(),
                day_of_week.trim(),
                start_time.includes(':') ? start_time : start_time + ':00',
                end_time.includes(':') ? end_time : end_time + ':00',
                subject.trim(),
                teacher.trim(),
                room ? room.trim() : ''
            ]
        );
        
        res.json({
            success: true,
            schedule: result.rows[0]
        });
    } catch (error) {
        console.error('Create schedule error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания урока'
        });
    }
});

// 10. УДАЛИТЬ ОБЪЯВЛЕНИЕ
app.delete('/api/announcements/:id', checkDatabase, requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.query(
            'DELETE FROM announcements WHERE id = $1 RETURNING *',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Объявление не найдено'
            });
        }
        
        res.json({
            success: true,
            message: 'Объявление удалено'
        });
        
    } catch (error) {
        console.error('Delete announcement error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления объявления'
        });
    }
});

// 11. УДАЛИТЬ УРОК
app.delete('/api/schedules/:id', checkDatabase, requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.query(
            'DELETE FROM schedules WHERE id = $1 RETURNING *',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Урок не найден'
            });
        }
        
        res.json({
            success: true,
            message: 'Урок удален'
        });
        
    } catch (error) {
        console.error('Delete schedule error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления урока'
        });
    }
});

// 12. ДОБАВИТЬ НОВОГО ПОЛЬЗОВАТЕЛЯ (админ)
app.post('/api/admin/users', checkDatabase, requireAuth, async (req, res) => {
    try {
        if (!['director', 'deputy'].includes(req.userRole)) {
            return res.status(403).json({
                success: false,
                error: 'Недостаточно прав'
            });
        }
        
        const { username, password, full_name, role } = req.body;
        
        if (!username || !password || !full_name || !role) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все поля'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен быть не менее 6 символов'
            });
        }
        
        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await db.query(
            `INSERT INTO users (username, password, full_name, role) 
             VALUES ($1, $2, $3, $4) 
             RETURNING id, username, full_name, role, created_at`,
            [username, hashedPassword, full_name, role]
        );
        
        res.json({
            success: true,
            message: 'Пользователь создан успешно',
            user: result.rows[0]
        });
        
    } catch (error) {
        console.error('Create user error:', error);
        
        // Если ошибка дублирования username
        if (error.code === '23505') {
            return res.status(400).json({
                success: false,
                error: 'Пользователь с таким логином уже существует'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Ошибка создания пользователя'
        });
    }
});

// 13. ПОЛУЧИТЬ ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ
app.get('/api/auth/profile', checkDatabase, requireAuth, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, username, full_name, role, created_at, last_login FROM users WHERE id = $1',
            [req.userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        res.json({
            success: true,
            user: result.rows[0]
        });
        
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профиля'
        });
    }
});
// 14. ОБНОВИТЬ ПОЛЬЗОВАТЕЛЯ
app.put('/api/admin/users/:id', checkDatabase, requireAuth, async (req, res) => {
    try {
        if (!['director', 'deputy'].includes(req.userRole)) {
            return res.status(403).json({ success: false, error: 'Недостаточно прав' });
        }
        
        const { id } = req.params;
        const { full_name, role } = req.body;
        
        const result = await db.query(
            'UPDATE users SET full_name = $1, role = $2 WHERE id = $3 RETURNING id, username, full_name, role, created_at, last_login',
            [full_name, role, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }
        
        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления пользователя' });
    }
});

// 15. УДАЛИТЬ ПОЛЬЗОВАТЕЛЯ
app.delete('/api/admin/users/:id', checkDatabase, requireAuth, async (req, res) => {
    try {
        if (!['director', 'deputy'].includes(req.userRole)) {
            return res.status(403).json({ success: false, error: 'Недостаточно прав' });
        }
        
        const { id } = req.params;
        
        const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }
        
        res.json({ success: true, message: 'Пользователь удален' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ success: false, error: 'Ошибка удаления пользователя' });
    }
});

// 16. СБРОС ПАРОЛЯ ПОЛЬЗОВАТЕЛЯ
app.post('/api/admin/users/:id/reset-password', checkDatabase, requireAuth, async (req, res) => {
    try {
        if (!['director', 'deputy'].includes(req.userRole)) {
            return res.status(403).json({ success: false, error: 'Недостаточно прав' });
        }
        
        const { id } = req.params;
        const { newPassword } = req.body;
        
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, error: 'Пароль должен быть не менее 6 символов' });
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        const result = await db.query(
            'UPDATE users SET password = $1 WHERE id = $2 RETURNING id',
            [hashedPassword, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }
        
        res.json({ success: true, message: 'Пароль успешно изменен' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, error: 'Ошибка сброса пароля' });
    }
});

// 17. ОБНОВИТЬ ОБЪЯВЛЕНИЕ
app.put('/api/announcements/:id', checkDatabase, requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, category, type, pinned, urgent } = req.body;
        
        const result = await db.query(
            `UPDATE announcements 
             SET title = $1, content = $2, category = $3, type = $4, pinned = $5, urgent = $6
             WHERE id = $7 RETURNING *`,
            [title, content, category, type, pinned, urgent, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Объявление не найдено' });
        }
        
        res.json({ success: true, announcement: result.rows[0] });
    } catch (error) {
        console.error('Update announcement error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления объявления' });
    }
});

// 18. ОБНОВИТЬ УРОК
app.put('/api/schedules/:id', checkDatabase, requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { class_number, class_letter, day_of_week, start_time, end_time, subject, teacher, room } = req.body;
        
        const result = await db.query(
            `UPDATE schedules 
             SET class_number = $1, class_letter = $2, day_of_week = $3, 
                 start_time = $4, end_time = $5, subject = $6, teacher = $7, room = $8
             WHERE id = $9 RETURNING *`,
            [class_number, class_letter, day_of_week, start_time, end_time, subject, teacher, room, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Урок не найден' });
        }
        
        res.json({ success: true, schedule: result.rows[0] });
    } catch (error) {
        console.error('Update schedule error:', error);
        res.status(500).json({ success: false, error: 'Ошибка обновления урока' });
    }
});

// ========== СТАТИЧЕСКИЕ ФАЙЛЫ ==========
app.use(express.static(FRONTEND_PATH));

// ========== ВСЕ ОСТАЛЬНЫЕ ЗАПРОСЫ → index.html ==========
app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
});

// ========== ОБРАБОТКА ОШИБОК ==========
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера'
    });
});

// Запуск сервера - ВАЖНО: добавляем '0.0.0.0' для Render
app.listen(PORT, '0.0.0.0', () => {
    console.log('=========================================');
    console.log(`🚀 Сервер запущен на порту: ${PORT}`);
    console.log(`📁 Frontend путь: ${FRONTEND_PATH}`);
    console.log(`🔐 JWT Secret: ${JWT_SECRET ? 'Установлен' : 'По умолчанию'}`);
    console.log(`🌐 Режим: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🗄️ Database: ${isDatabaseConnected ? 'Подключен' : 'Не подключен'}`);
    console.log('=========================================');
});
