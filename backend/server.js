const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Подключение к PostgreSQL
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'school_portal',
  user: 'postgres',
  password: 'postgres' // ТВОЙ ПАРОЛЬ
});

// Проверка подключения
pool.connect()
  .then(() => console.log('✅ Подключились к PostgreSQL'))
  .catch(err => {
    console.error('❌ Ошибка подключения:', err.message);
    process.exit(1);
  });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('C:/Users/smile300822/Desktop/school-portal/frontend')); // Раздаём статические файлы

// ============ API ДЛЯ ОБЪЯВЛЕНИЙ ============

// 1. Получить ВСЕ объявления
app.get('/api/announcements', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM announcements ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Ошибка GET:', err);
    res.status(500).json({ error: 'Не удалось загрузить объявления' });
  }
});

// 2. Создать новое объявление
app.post('/api/announcements', async (req, res) => {
  try {
    const { 
      title, 
      content, 
      category = 'students', 
      type = 'announcement',
      author = 'Администрация',
      pinned = false,
      urgent = false
    } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ error: 'Нужны заголовок и текст' });
    }
    
    const result = await pool.query(
      `INSERT INTO announcements 
       (title, content, category, type, author, pinned, urgent) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [title, content, category, type, author, pinned, urgent]
    );
    
    res.json({ 
      success: true, 
      announcement: result.rows[0] 
    });
  } catch (err) {
    console.error('Ошибка POST:', err);
    res.status(500).json({ error: 'Не удалось создать объявление' });
  }
});

// 3. Обновить объявление
app.put('/api/announcements/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      title, 
      content, 
      category, 
      type,
      author,
      pinned,
      urgent
    } = req.body;
    
    const result = await pool.query(
      `UPDATE announcements 
       SET title = $1, 
           content = $2, 
           category = $3, 
           type = $4,
           author = $5,
           pinned = $6,
           urgent = $7,
           updated_at = NOW()
       WHERE id = $8 
       RETURNING *`,
      [title, content, category, type, author, pinned, urgent, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Объявление не найдено' });
    }
    
    res.json({ 
      success: true, 
      announcement: result.rows[0] 
    });
  } catch (err) {
    console.error('Ошибка PUT:', err);
    res.status(500).json({ error: 'Не удалось обновить объявление' });
  }
});

// 4. Удалить объявление
app.delete('/api/announcements/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM announcements WHERE id = $1 RETURNING id',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Объявление не найдено' });
    }
    
    res.json({ 
      success: true, 
      message: 'Объявление удалено' 
    });
  } catch (err) {
    console.error('Ошибка DELETE:', err);
    res.status(500).json({ error: 'Не удалось удалить объявление' });
  }
});

// В твой server.js ДОБАВЛЯЕМ после API для объявлений:

// ============ API ДЛЯ РАСПИСАНИЙ ============

// 1. Получить все расписания (с фильтрацией по классу)
app.get('/api/schedules', async (req, res) => {
  try {
    const { class_number, class_letter, day } = req.query;
    let query = 'SELECT * FROM schedules';
    const params = [];
    
    if (class_number || class_letter || day) {
      const conditions = [];
      
      if (class_number) {
        params.push(class_number);
        conditions.push(`class_number = $${params.length}`);
      }
      
      if (class_letter) {
        params.push(class_letter);
        conditions.push(`class_letter = $${params.length}`);
      }
      
      if (day) {
        params.push(day);
        conditions.push(`day_of_week = $${params.length}`);
      }
      
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY class_number, class_letter, day_of_week, lesson_number';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Ошибка GET расписаний:', err);
    res.status(500).json({ error: 'Не удалось загрузить расписание' });
  }
});

// 2. Получить список всех классов (для фильтров)
app.get('/api/schedules/classes', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT class_number, class_letter FROM schedules ORDER BY class_number, class_letter'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Ошибка GET классов:', err);
    res.status(500).json({ error: 'Не удалось загрузить классы' });
  }
});

// 3. Создать новый урок
app.post('/api/schedules', async (req, res) => {
  try {
    const { 
      class_number, 
      class_letter, 
      day_of_week, 
      lesson_number, 
      start_time, 
      end_time, 
      subject, 
      teacher, 
      room 
    } = req.body;
    
    // Проверка обязательных полей
    if (!class_number || !class_letter || !day_of_week || !lesson_number || 
        !start_time || !end_time || !subject || !teacher) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }
    
    const result = await pool.query(
      `INSERT INTO schedules 
       (class_number, class_letter, day_of_week, lesson_number, start_time, end_time, subject, teacher, room) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [class_number, class_letter, day_of_week, lesson_number, 
       start_time, end_time, subject, teacher, room || null]
    );
    
    res.json({ 
      success: true, 
      data: result.rows[0] 
    });
  } catch (err) {
    console.error('Ошибка POST расписания:', err);
    
    // Проверка на дублирование урока
    if (err.code === '23505') { // Код уникального ограничения в PostgreSQL
      res.status(400).json({ 
        error: 'У этого класса уже есть урок в это время и день недели' 
      });
    } else {
      res.status(500).json({ error: 'Не удалось создать урок' });
    }
  }
});

// 4. Обновить урок
app.put('/api/schedules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      class_number, 
      class_letter, 
      day_of_week, 
      lesson_number, 
      start_time, 
      end_time, 
      subject, 
      teacher, 
      room 
    } = req.body;
    
    const result = await pool.query(
      `UPDATE schedules 
       SET class_number = $1, 
           class_letter = $2, 
           day_of_week = $3, 
           lesson_number = $4,
           start_time = $5,
           end_time = $6,
           subject = $7,
           teacher = $8,
           room = $9,
           updated_at = NOW()
       WHERE id = $10 
       RETURNING *`,
      [class_number, class_letter, day_of_week, lesson_number, 
       start_time, end_time, subject, teacher, room || null, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Урок не найден' });
    }
    
    res.json({ 
      success: true, 
      data: result.rows[0] 
    });
  } catch (err) {
    console.error('Ошибка PUT расписания:', err);
    res.status(500).json({ error: 'Не удалось обновить урок' });
  }
});

// 5. Удалить урок
app.delete('/api/schedules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM schedules WHERE id = $1 RETURNING id',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Урок не найден' });
    }
    
    res.json({ 
      success: true, 
      message: 'Урок удален' 
    });
  } catch (err) {
    console.error('Ошибка DELETE расписания:', err);
    res.status(500).json({ error: 'Не удалось удалить урок' });
  }
});

// 6. Получить расписание для класса (для публичного сайта)
app.get('/api/schedules/class/:class_number/:class_letter', async (req, res) => {
  try {
    const { class_number, class_letter } = req.params;
    
    const result = await pool.query(
      `SELECT * FROM schedules 
       WHERE class_number = $1 AND class_letter = $2 
       ORDER BY 
         CASE day_of_week 
           WHEN 'monday' THEN 1
           WHEN 'tuesday' THEN 2
           WHEN 'wednesday' THEN 3
           WHEN 'thursday' THEN 4
           WHEN 'friday' THEN 5
           WHEN 'saturday' THEN 6
           ELSE 7
         END,
         lesson_number`,
      [class_number, class_letter]
    );
    
    // Группируем по дням недели для удобного отображения
    const groupedByDay = {};
    const daysInOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    
    result.rows.forEach(lesson => {
      const day = lesson.day_of_week;
      if (!groupedByDay[day]) {
        groupedByDay[day] = [];
      }
      groupedByDay[day].push(lesson);
    });
    
    // Сортируем дни в правильном порядке
    const sortedSchedule = {};
    daysInOrder.forEach(day => {
      if (groupedByDay[day]) {
        sortedSchedule[day] = groupedByDay[day];
      }
    });
    
    res.json(sortedSchedule);
  } catch (err) {
    console.error('Ошибка GET расписания класса:', err);
    res.status(500).json({ error: 'Не удалось загрузить расписание' });
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
  console.log(`📡 API объявления: http://localhost:${PORT}/api/announcements`);
  console.log(`📡 API расписание: http://localhost:${PORT}/api/schedules`);
  console.log(`🌐 Сайт: http://localhost:${PORT}/announcements.html`);
  console.log(`📅 Расписание: http://localhost:${PORT}/schedule.html`);
  console.log(`🔧 Админка: http://localhost:${PORT}/admin.html`);
});