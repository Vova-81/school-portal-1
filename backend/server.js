const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// ========== БАЗОВЫЕ НАСТРОЙКИ ==========
app.use(cors());
app.use(express.json());

// ========== СТАТИЧЕСКИЕ ФАЙЛЫ ==========
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend');
console.log('📁 Путь к фронтенду:', FRONTEND_PATH);

app.use(express.static(FRONTEND_PATH));

// ========== ПУСТЫЕ МАССИВЫ ДАННЫХ ==========
let users = [];
let announcements = [];
let schedules = [];

// ========== МИДЛВЭР ДЛЯ ЛОГИРОВАНИЯ ==========
app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.path}`, req.body || '');
    next();
});

// ========== API ДЛЯ ПРОВЕРКИ СЕРВЕРА ==========
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Сервер работает',
        hasUsers: users.length > 0,
        timestamp: new Date().toISOString()
    });
});

// ========== API ДЛЯ ПРОВЕРКИ, НУЖЕН ЛИ ПЕРВЫЙ АДМИН ==========
app.get('/api/setup/check', (req, res) => {
    res.json({ 
        needsSetup: users.length === 0,
        message: users.length === 0 ? 'Требуется создание первого администратора' : 'Система настроена'
    });
});

// ========== API АВТОРИЗАЦИИ ==========
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ 
            success: false, 
            error: 'Введите логин и пароль' 
        });
    }
    
    const user = users.find(u => u.username === username);
    if (!user) {
        return res.status(401).json({ 
            success: false, 
            error: 'Неверный логин или пароль' 
        });
    }
    
    if (user.password !== password) {
        return res.status(401).json({ 
            success: false, 
            error: 'Неверный логин или пароль' 
        });
    }
    
    user.last_login = new Date().toISOString();
    
    const token = `token-${user.id}-${Date.now()}`;
    
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({
        success: true,
        token,
        user: userWithoutPassword
    });
});

// ========== СОЗДАНИЕ ПЕРВОГО АДМИНИСТРАТОРА ==========
app.post('/api/setup/first-admin', (req, res) => {
    if (users.length > 0) {
        return res.status(400).json({
            success: false,
            error: 'Администратор уже создан'
        });
    }
    
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
    
    const firstAdmin = {
        id: 1,
        username,
        full_name,
        role: 'director',
        password,
        created_at: new Date().toISOString(),
        last_login: null
    };
    
    users.push(firstAdmin);
    
    const { password: _, ...adminWithoutPassword } = firstAdmin;
    
    res.json({
        success: true,
        message: 'Первый администратор создан успешно',
        user: adminWithoutPassword
    });
});

// ========== МИДЛВЭР ДЛЯ ПРОВЕРКИ АВТОРИЗАЦИИ ==========
const requireAuth = (req, res, next) => {
    console.log('🔐 Проверка авторизации для:', req.path);
    
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        console.log('❌ Нет заголовка Authorization');
        return res.status(401).json({ 
            success: false, 
            error: 'Требуется авторизация. Пожалуйста, войдите в систему.' 
        });
    }
    
    // Удаляем "Bearer " если есть
    const token = authHeader.replace('Bearer ', '');
    
    console.log('📝 Полученный токен:', token.substring(0, 20) + '...');
    
    if (!token.startsWith('token-')) {
        console.log('❌ Неверный формат токена');
        return res.status(401).json({ 
            success: false, 
            error: 'Неверный токен' 
        });
    }
    
    const tokenParts = token.split('-');
    if (tokenParts.length < 3) {
        console.log('❌ Токен поврежден');
        return res.status(401).json({ 
            success: false, 
            error: 'Токен поврежден' 
        });
    }
    
    const userId = parseInt(tokenParts[1]);
    const user = users.find(u => u.id === userId);
    
    if (!user) {
        console.log('❌ Пользователь не найден по токену, ID:', userId);
        return res.status(401).json({ 
            success: false, 
            error: 'Пользователь не найден' 
        });
    }
    
    // Проверяем роль (только director или deputy могут в админку)
    if (!['director', 'deputy'].includes(user.role)) {
        console.log('❌ Недостаточно прав, роль:', user.role);
        return res.status(403).json({ 
            success: false, 
            error: 'Недостаточно прав' 
        });
    }
    
    console.log('✅ Авторизация успешна для:', user.username, 'роль:', user.role);
    
    req.user = user;
    next();
};

// ========== API АДМИНИСТРАТИВНЫХ ПОЛЬЗОВАТЕЛЕЙ ==========
app.get('/api/admin/users', requireAuth, (req, res) => {
    console.log('👥 GET /api/admin/users - запрос от:', req.user.username);
    
    const usersWithoutPasswords = users.map(user => {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    });
    
    res.json({ 
        success: true, 
        users: usersWithoutPasswords 
    });
});

app.post('/api/admin/users', requireAuth, (req, res) => {
    console.log('➕ POST /api/admin/users - запрос от:', req.user.username);
    
    const { username, password, full_name, role } = req.body;
    
    if (!username || !password || !full_name || !role) {
        return res.status(400).json({ 
            success: false, 
            error: 'Заполните все поля' 
        });
    }
    
    if (!['director', 'deputy'].includes(role)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Недопустимая роль' 
        });
    }
    
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Логин уже занят' 
        });
    }
    
    const newId = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
    
    const newUser = {
        id: newId,
        username,
        full_name,
        role,
        password,
        created_at: new Date().toISOString(),
        last_login: null
    };
    
    users.push(newUser);
    
    const { password: _, ...userWithoutPassword } = newUser;
    
    res.json({ 
        success: true, 
        user: userWithoutPassword 
    });
});

app.put('/api/admin/users/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const { full_name, role } = req.body;
    
    const userIndex = users.findIndex(u => u.id == id);
    if (userIndex === -1) {
        return res.status(404).json({ 
            success: false, 
            error: 'Пользователь не найден' 
        });
    }
    
    users[userIndex].full_name = full_name;
    users[userIndex].role = role;
    
    const { password: _, ...userWithoutPassword } = users[userIndex];
    
    res.json({ 
        success: true, 
        user: userWithoutPassword 
    });
});

app.post('/api/admin/users/:id/reset-password', requireAuth, (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body;
    
    const user = users.find(u => u.id == id);
    if (!user) {
        return res.status(404).json({ 
            success: false, 
            error: 'Пользователь не найден' 
        });
    }
    
    if (newPassword.length < 6) {
        return res.status(400).json({
            success: false,
            error: 'Пароль должен быть не менее 6 символов'
        });
    }
    
    user.password = newPassword;
    
    res.json({ 
        success: true, 
        message: 'Пароль успешно изменен'
    });
});

app.delete('/api/admin/users/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    
    if (id == req.user.id) {
        return res.status(400).json({ 
            success: false, 
            error: 'Нельзя удалить самого себя' 
        });
    }
    
    const userIndex = users.findIndex(u => u.id == id);
    if (userIndex === -1) {
        return res.status(404).json({ 
            success: false, 
            error: 'Пользователь не найден' 
        });
    }
    
    users.splice(userIndex, 1);
    
    res.json({ 
        success: true, 
        message: 'Пользователь удален'
    });
});

// ========== API ОБЪЯВЛЕНИЙ ==========
app.get('/api/announcements', (req, res) => {
    res.json(announcements);
});

app.post('/api/announcements', requireAuth, (req, res) => {
    const { title, content, category, type, pinned, urgent } = req.body;
    
    if (!title || !content) {
        return res.status(400).json({ 
            success: false, 
            error: 'Заполните заголовок и содержание' 
        });
    }
    
    const newId = announcements.length > 0 ? Math.max(...announcements.map(a => a.id)) + 1 : 1;
    
    const newAnnouncement = {
        id: newId,
        title,
        content,
        category: category || 'all',
        type: type || 'announcement',
        author: req.user.full_name || req.user.username,
        pinned: Boolean(pinned),
        urgent: Boolean(urgent),
        created_at: new Date().toISOString()
    };
    
    announcements.push(newAnnouncement);
    
    res.json({ 
        success: true, 
        announcement: newAnnouncement 
    });
});

app.put('/api/announcements/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const { title, content, category, type, pinned, urgent } = req.body;
    
    const annIndex = announcements.findIndex(a => a.id == id);
    if (annIndex === -1) {
        return res.status(404).json({ 
            success: false, 
            error: 'Объявление не найдено' 
        });
    }
    
    announcements[annIndex] = {
        ...announcements[annIndex],
        title: title || announcements[annIndex].title,
        content: content || announcements[annIndex].content,
        category: category || announcements[annIndex].category,
        type: type || announcements[annIndex].type,
        pinned: pinned !== undefined ? Boolean(pinned) : announcements[annIndex].pinned,
        urgent: urgent !== undefined ? Boolean(urgent) : announcements[annIndex].urgent
    };
    
    res.json({ 
        success: true, 
        announcement: announcements[annIndex] 
    });
});

app.delete('/api/announcements/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    
    const annIndex = announcements.findIndex(a => a.id == id);
    if (annIndex === -1) {
        return res.status(404).json({ 
            success: false, 
            error: 'Объявление не найдено' 
        });
    }
    
    announcements.splice(annIndex, 1);
    
    res.json({ 
        success: true, 
        message: 'Объявление удалено' 
    });
});

// ========== API РАСПИСАНИЯ ==========
app.get('/api/schedules', (req, res) => {
    res.json(schedules);
});

app.post('/api/schedules', requireAuth, (req, res) => {
    const { class_number, class_letter, day_of_week, start_time, end_time, subject, teacher, room } = req.body;
    
    if (!class_number || !class_letter || !day_of_week || !start_time || !end_time || !subject || !teacher) {
        return res.status(400).json({ 
            success: false, 
            error: 'Заполните все обязательные поля' 
        });
    }
    
    const newId = schedules.length > 0 ? Math.max(...schedules.map(s => s.id)) + 1 : 1;
    
    const newSchedule = {
        id: newId,
        class_number: parseInt(class_number),
        class_letter,
        day_of_week,
        start_time: start_time.includes(':') ? start_time : start_time + ':00',
        end_time: end_time.includes(':') ? end_time : end_time + ':00',
        subject,
        teacher,
        room: room || '',
        created_at: new Date().toISOString()
    };
    
    schedules.push(newSchedule);
    
    res.json({ 
        success: true, 
        schedule: newSchedule 
    });
});

app.put('/api/schedules/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const { class_number, class_letter, day_of_week, start_time, end_time, subject, teacher, room } = req.body;
    
    const scheduleIndex = schedules.findIndex(s => s.id == id);
    if (scheduleIndex === -1) {
        return res.status(404).json({ 
            success: false, 
            error: 'Урок не найден' 
        });
    }
    
    schedules[scheduleIndex] = {
        ...schedules[scheduleIndex],
        class_number: class_number || schedules[scheduleIndex].class_number,
        class_letter: class_letter || schedules[scheduleIndex].class_letter,
        day_of_week: day_of_week || schedules[scheduleIndex].day_of_week,
        start_time: start_time || schedules[scheduleIndex].start_time,
        end_time: end_time || schedules[scheduleIndex].end_time,
        subject: subject || schedules[scheduleIndex].subject,
        teacher: teacher || schedules[scheduleIndex].teacher,
        room: room || schedules[scheduleIndex].room
    };
    
    res.json({ 
        success: true, 
        schedule: schedules[scheduleIndex] 
    });
});

app.delete('/api/schedules/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    
    const scheduleIndex = schedules.findIndex(s => s.id == id);
    if (scheduleIndex === -1) {
        return res.status(404).json({ 
            success: false, 
            error: 'Урок не найден' 
        });
    }
    
    schedules.splice(scheduleIndex, 1);
    
    res.json({ 
        success: true, 
        message: 'Урок удален' 
    });
});

// ========== ДЕБАГ ЭНДПОИНТЫ ==========
app.get('/api/debug/users', (req, res) => {
    console.log('🔍 DEBUG: Все пользователи в памяти:', users);
    
    res.json({
        success: true,
        users_count: users.length,
        users: users.map(u => ({
            id: u.id,
            username: u.username,
            full_name: u.full_name,
            role: u.role,
            created_at: u.created_at,
            last_login: u.last_login,
            has_password: !!u.password
        })),
        announcements_count: announcements.length,
        schedules_count: schedules.length
    });
});

app.get('/api/debug/token-test', requireAuth, (req, res) => {
    res.json({
        success: true,
        message: 'Токен работает!',
        user: req.user
    });
});

// ========== ОБРАБОТКА 404 ==========
app.use('*', (req, res) => {
    if (req.originalUrl.startsWith('/api/')) {
        res.status(404).json({ 
            success: false, 
            error: 'API endpoint не найден' 
        });
    } else {
        res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
    }
});

// ========== ЗАПУСК СЕРВЕРА ==========
app.listen(PORT, () => {
    console.log(`
🚀 Сервер запущен: http://localhost:${PORT}
📁 Обслуживает файлы из: ${FRONTEND_PATH}

📊 Состояние системы:
   • Пользователи: ${users.length}
   • Объявления: ${announcements.length}
   • Уроки: ${schedules.length}

🔐 Админ API защищены авторизацией
🌐 Открывайте: http://localhost:${PORT}/login.html

📋 Дебаг эндпоинты:
   • GET /api/debug/users      - Все пользователи (без защиты)
   • GET /api/debug/token-test - Тест токена (с защитой)
`);
});