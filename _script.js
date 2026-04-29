let currentUser = null; // Больше не читаем логин из браузера! Ждем ответа сервера.
let currentCategory = 'bases';
let currentSettings = { store_enabled: true, wiki_enabled: true };
let currentToken = localStorage.getItem('user_token'); // Храним ТОЛЬКО токен
let currentDeviceId = localStorage.getItem('device_id'); // Память о доверенном ПК

// НОВАЯ ФУНКЦИЯ: Проверка токена у сервера
async function verifySession() {
    if (!currentToken) return; // Если токена нет, мы просто гость
    try {
        const res = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: currentToken })
        });
        const data = await res.json();
        if (data.success) {
            currentUser = data.login; // Сервер подтвердил! Записываем логин
        } else {
            // Если токен поддельный - уничтожаем его
            currentToken = null;
            localStorage.removeItem('user_token');
        }
    } catch(e) {}
}

window.onload = async () => {
    // ЖДЕМ, пока сервер проверит нас, и только потом рисуем сайт!
    await verifySession(); 
    
    updateHeader();
    loadNews(); 
    loadWiki();
    loadSettings();

    const hash = window.location.hash.substring(1);
    
    if (hash.startsWith('product-')) {
        const productId = hash.split('-')[1];
        switchTab('store', document.querySelectorAll('.tab-btn')[1]);
        setTimeout(() => openProductModal(productId), 500); // Ждем загрузки товаров и открываем модалку
    } else if (hash === 'store') {
        switchTab('store', document.querySelectorAll('.tab-btn')[1]);
    } else if (hash === 'wiki') {
        switchTab('wiki', document.querySelectorAll('.tab-btn')[2]);
    // Проверка adminsList ниже сработает правильно, т.к. сервер уже вернул нам currentUser
    } else if (hash === 'admin' && currentUser && adminsList.includes(currentUser)) {
        openAdminTab();
    } else {
        switchTab('news', document.querySelectorAll('.tab-btn')[0]); 
    }
};

// === 1. ЛОГИКА ВКЛАДОК (НОВОСТИ / МАГАЗИН) ===
function switchTab(tabId, btnElement) {
    // Меняем адресную строку браузера без перезагрузки (добавляем якорь)
    window.history.pushState(null, null, '#' + tabId);

    // Убираем активный класс у всех кнопок в шапке
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');

    // Скрываем все секции
    document.querySelectorAll('.tab-content').forEach(sec => sec.classList.remove('active-tab'));
    
    // Показываем нужную
    document.getElementById('tab-' + tabId).classList.add('active-tab');

    // Если открыли магазин - грузим первую категорию
    if (tabId === 'store') {
        loadCategory('bases', document.querySelectorAll('.cat-btn')[0]);
    }
}

// === 2. ЗАГРУЗКА И ОТРИСОВКА МАГАЗИНА ===
async function loadCategory(category, btnElement) {
    currentCategory = category;
    
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    if(btnElement) btnElement.classList.add('active');

    const container = document.getElementById('products');
    container.innerHTML = '<p style="color:#888">Связь с базой данных...</p>';

    try {
        const res = await fetch('/api/products');
        const data = await res.json();
        const items = data[category];

        container.innerHTML = ''; 

        if (!items || items.length === 0) {
            container.innerHTML = '<p style="color:#888">В этой категории пока нет товаров.</p>';
            return;
        }

        items.forEach(item => {
            const card = document.createElement('div');
            // В БД у нас поле теперь называется is_rented
            const isRented = (category === 'bases' && item.is_rented); 
            
            card.className = isRented ? 'card rented' : 'card';

            // Делаем карточку кликабельной!
            if (!isRented) {
                card.style.cursor = 'pointer';
                card.onclick = () => openProductModal(item.id);
            }

            card.innerHTML = `
                ${item.image ? `<img src="${item.image}" style="width:100%; height:120px; object-fit:cover; border-radius:4px; margin-bottom:10px;">` : ''}
                <h3>${item.name}</h3>
                <p class="price">${item.price} ₽</p>
                <p style="color: #888; font-size: 13px; margin-bottom: 20px;">Срок: ${item.days > 0 ? item.days : 'Навсегда'} дн.</p>
            `;
            container.appendChild(card);
        });

    } catch (e) {
        container.innerHTML = '<p style="color:#ff4d4d">Ошибка подключения к серверу.</p>';
    }
}

// === 3. ЛОГИКА ПОКУПКИ И ОКНА ТОВАРА ===
function tryBuy(id) {
    if (!currentUser) {
        closeProductModal(); 
        document.getElementById('loginModal').style.display = 'flex'; 
        return;
    }

    if(!confirm('Подтверждаете покупку? Транзакция будет отправлена на сервер.')) return;

    fetch('/api/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentToken, productId: id })
    })
    .then(res => res.json())
    .then(data => {
        alert(data.message);
        if(data.success) {
            closeProductModal();
            loadCategory(currentCategory, document.querySelector('.cat-btn.active'));
        }
    });
}

// Открытие карточки
async function openProductModal(id) {
    try {
        const res = await fetch('/api/products');
        const data = await res.json();
        const allItems = [...(data.bases || []), ...(data.money || []), ...(data.loot || [])];
        const item = allItems.find(p => p.id == id);
        
        if (!item) return alert('Товар не найден');

        document.getElementById('pm-title').innerHTML = `${item.name} <span class="close-btn" onclick="closeProductModal()">&times;</span>`;
        document.getElementById('pm-desc').innerHTML = item.description || 'Описание отсутствует.';
        document.getElementById('pm-price').innerText = `${item.price} ₽`;
        document.getElementById('pm-days').innerText = item.days > 0 ? `На ${item.days} дней` : 'Навсегда';
        
        const img = document.getElementById('pm-img');
        if (item.image) { img.src = item.image; img.style.display = 'block'; } 
        else { img.style.display = 'none'; }

        const btn = document.getElementById('pm-buy-btn');
        if (item.is_rented) {
            btn.innerText = 'НЕТ В НАЛИЧИИ'; btn.disabled = true;
        } else {
            btn.innerText = 'ПРИОБРЕСТИ'; btn.disabled = false;
            btn.onclick = () => tryBuy(item.id);
        }

        document.getElementById('pm-link').value = window.location.origin + window.location.pathname + '#product-' + item.id;
        document.getElementById('productModal').style.display = 'flex';
        window.history.pushState(null, null, '#product-' + item.id);
    } catch (e) {}
}

function closeProductModal() {
    document.getElementById('productModal').style.display = 'none';
    window.history.pushState(null, null, '#store'); 
}

// === АВТОРИЗАЦИЯ ===
async function loginUser() {
    const login = document.getElementById('loginInput').value;
    const pass = document.getElementById('passInput').value;
    const codeInput = document.getElementById('codeInput');
    const errorMsg = document.getElementById('errorMsg');

    if (codeInput.style.display === 'block') {
        // ШАГ 2: Ввод кода
        const res = await fetch('/api/login/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login, password: pass, code: codeInput.value })
        });
        const data = await res.json();
        handleLoginResponse(data);
    } else {
        // ШАГ 1: Ввод пароля
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login, password: pass, device_id: currentDeviceId })
        });
        const data = await res.json();

        if (data.requireCode) {
            codeInput.style.display = 'block';
            errorMsg.innerText = data.message;
            errorMsg.style.color = '#c9a227'; 
        } else {
            handleLoginResponse(data);
        }
    }
}

function handleLoginResponse(data) {
    if (data.success) {
        currentUser = data.user;
        currentToken = data.token; 
        localStorage.setItem('user_token', currentToken); 
        
        if (data.device_id) {
            currentDeviceId = data.device_id;
            localStorage.setItem('device_id', currentDeviceId);
        }
        
        closeModal();
        updateHeader();
        if (adminsList.includes(currentUser)) {
            renderNews();
            renderWiki();
        }
    } else {
        document.getElementById('errorMsg').innerText = data.message;
        document.getElementById('errorMsg').style.color = '#ff4d4d'; 
    }
}

// === ВЫХОД ИЗ АККАУНТА ===
async function logout() {
    // 1. Говорим серверу сжечь токен
    if (currentToken) {
        try {
            await fetch('/api/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: currentToken })
            });
        } catch(e) {}
    }

    // 2. Сбрасываем переменные в коде
    currentUser = null;
    currentToken = null; 
    
    // 3. Полностью зачищаем память браузера
    localStorage.removeItem('user_token'); 
    
    // 4. Обновляем визуал и выкидываем на главную
    updateHeader();
    renderNews(); 
    renderWiki(); 
    switchTab('news', document.querySelectorAll('.tab-btn')[0]); 
}

function updateHeader() {
    applySettings();
    const panel = document.getElementById('auth-panel');
    const adminBtn = document.getElementById('admin-btn');
    
    // Логика отображения кнопки АДМИН-ПАНЕЛЬ
    const admins = ['Tizi', 'Admin', 'TvoiLoginВIgre']; 
    
    // ТЕПЕРЬ ПРОВЕРЯЕМ ЕЩЁ И НАЛИЧИЕ ТОКЕНА (currentToken)
    if (currentUser && currentToken && admins.includes(currentUser)) {
        adminBtn.style.display = 'block';
    } else {
        adminBtn.style.display = 'none';
    }

    // ТЕПЕРЬ ПРОВЕРЯЕМ ЕЩЁ И НАЛИЧИЕ ТОКЕНА
    if (currentUser && currentToken) {
        panel.innerHTML = `
            <span style="color: var(--inv-accent); font-weight: bold; margin-right: 15px;">${currentUser}</span>
            <button class="header-auth-btn" onclick="logout()">ВЫЙТИ</button>
        `;
    } else {
        panel.innerHTML = `<button class="header-auth-btn action-accent" onclick="document.getElementById('loginModal').style.display='flex'">ВОЙТИ</button>`;
    }
}

function closeModal() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('errorMsg').innerText = '';
    // Прячем и очищаем поле кода
    document.getElementById('codeInput').style.display = 'none';
    document.getElementById('codeInput').value = '';
}


// === ЛОГИКА НОВОСТЕЙ (С БАЗЫ ДАННЫХ) ===
let serverNews = [];
let serverWiki = [];
let currentFeaturedIndex = 0;
let editingPostId = null; // ID редактируемого поста
let editingPostType = 'news'; // 'news' или 'wiki'
const adminsList = ['Tizi'];

// Загрузка новостей с сервера
async function loadNews() {
    try {
        const res = await fetch('/api/news');
        let fetchedNews = await res.json();
        
        // Умная сортировка по дате (парсим наши русские даты)
        const months = ["Января", "Февраля", "Марта", "Апреля", "Мая", "Июня", "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря"];
        
        fetchedNews.sort((a, b) => {
            let dateA = new Date(0), dateB = new Date(0);
            
            // Разбиваем строку "21 Февраля 2026" на [21, Февраля, 2026]
            let partsA = a.date.split(' ');
            if (partsA.length === 3) dateA = new Date(partsA[2], months.indexOf(partsA[1]), partsA[0]);
            
            let partsB = b.date.split(' ');
            if (partsB.length === 3) dateB = new Date(partsB[2], months.indexOf(partsB[1]), partsB[0]);
            
            // Если даты одинаковые, сортируем по порядку добавления (новые выше)
            if (dateB.getTime() === dateA.getTime()) {
                return b.id - a.id;
            }
            
            // Сортируем: от новых дат к старым
            return dateB - dateA; 
        });

        serverNews = fetchedNews;
        
        if (serverNews.length > 0) {
            renderNews();
        } else {
            document.getElementById('featured-news').innerHTML = '<p style="text-align:center; color:#888;">Обновлений пока нет.</p>';
            document.getElementById('news-list').innerHTML = '';
        }
    } catch (e) {
        console.error("Ошибка загрузки новостей", e);
    }
}

// Отрисовка
function renderNews() {
    const featuredContainer = document.getElementById('featured-news');
    const listContainer = document.getElementById('news-list');
    const feat = serverNews[currentFeaturedIndex];
    
    // Кнопка редактирования для админов
    let editBtnHtml = '';
    // Кнопки для админов (Редактировать и Удалить)
    let adminBtnsHtml = '';
    if (currentUser && adminsList.includes(currentUser)) {
        adminBtnsHtml = `
            <div style="float: right; display: flex; gap: 10px;">
                <button class="header-auth-btn" style="border-color: #c9a227; color: #c9a227; padding: 4px 10px; font-size: 12px;" onclick="openAdminTab(${currentFeaturedIndex})">✏️ РЕДАКТИРОВАТЬ</button>
                <button class="header-auth-btn" style="border-color: #ff4d4d; color: #ff4d4d; padding: 4px 10px; font-size: 12px;" onclick="deleteNews(${feat.id})">🗑️ УДАЛИТЬ</button>
            </div>
        `;
    }

    // Собираем главную новость вместе со скрытым блоком комментов
    featuredContainer.innerHTML = `
        ${adminBtnsHtml}
        <div class="news-date">${feat.date}</div>
        <h3 style="margin-top: 0; font-size: 36px;">${feat.title}</h3>
        <div style="margin-top: 20px; font-size: 16px;">${feat.content}</div>
        
        <div style="margin-top: 30px; border-top: 1px solid rgba(70, 76, 88, 0.3); padding-top: 15px;">
            <button class="comment-toggle-btn" onclick="toggleComments()">
                <span id="comment-count">0</span> Комментарии
            </button>
        </div>

        <div id="comments-slide-block" class="comments-slide">
            <div id="comments-list" style="margin-bottom: 15px; max-height: 400px; overflow-y: auto; padding-right: 10px;"></div>
            <div id="comment-form"></div>
        </div>
    `;

    // Отрисовка маленьких карточек внизу
    listContainer.innerHTML = '';
    serverNews.forEach((item, index) => {
        if (index === currentFeaturedIndex) return; 
        const card = document.createElement('div');
        card.className = 'small-news-card';
        card.onclick = () => {
            currentFeaturedIndex = index;
            renderNews();
            window.scrollTo({ top: 0, behavior: 'smooth' }); 
        };
        card.innerHTML = `
            <div class="news-date">${item.date}</div>
            <h3>${item.title}</h3>
            <div style="margin-top: 10px; font-size: 14px; color: #9a9691; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
                ${item.content.replace(/<[^>]*>?/gm, '')}
            </div>
        `;
        listContainer.appendChild(card);
    });

    loadComments(feat.id); // Запускаем загрузку комментариев
}

// Анимация открытия/закрытия комментов
function toggleComments() {
    document.getElementById('comments-slide-block').classList.toggle('open');
}

// === ПЕРЕКЛЮЧАТЕЛЬ РЕЖИМОВ (Визуал <-> HTML) ===
function toggleEditorMode() {
    const isHtmlMode = document.getElementById('htmlToggle').checked;
    const visualWrapper = document.getElementById('visual-editor-wrapper');
    const htmlEditor = document.getElementById('html-editor');

    if (isHtmlMode) {
        htmlEditor.value = quill.root.innerHTML === '<p><br></p>' ? '' : quill.root.innerHTML;
        visualWrapper.style.display = 'none';
        htmlEditor.style.display = 'block';
    } else {
        quill.root.innerHTML = htmlEditor.value;
        htmlEditor.style.display = 'none';
        visualWrapper.style.display = 'block';
    }
}

// === АДМИНКА ВО ВКЛАДКЕ (Заменяет старые модалки) ===
function openAdminTab(index = null, type = 'news') {
    switchTab('admin', document.getElementById('admin-btn'));
    
    if (index !== null) {
        // РЕДАКТИРОВАНИЕ
        const item = type === 'news' ? serverNews[index] : serverWiki[index];
        editingPostId = item.id;
        editingPostType = type;
        
        document.getElementById('postTarget').value = type;
        document.getElementById('postTarget').disabled = true; // Запрещаем менять тип при редактировании
        document.getElementById('newsTitle').value = item.title;
        
        setTimeout(() => {
            quill.clipboard.dangerouslyPasteHTML(item.content);
            document.getElementById('html-editor').value = item.content;
        }, 100);
    } else {
        // СОЗДАНИЕ
        editingPostId = null;
        document.getElementById('postTarget').disabled = false;
        document.getElementById('newsTitle').value = '';
        document.getElementById('html-editor').value = '';
        setTimeout(() => quill.setContents([]), 100);
    }
    
    if (document.getElementById('htmlToggle').checked) {
        document.getElementById('html-editor').style.display = 'block';
        document.getElementById('visual-editor-wrapper').style.display = 'none';
    }
}


// === УДАЛЕНИЕ НОВОСТИ (ДЛЯ АДМИНА) ===
async function deleteNews(newsId) {
    if (!confirm('Вы уверены, что хотите НАВСЕГДА удалить эту новость?')) return;

    const res = await fetch(`/api/news/${newsId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentToken })
    });
    
    const data = await res.json();
    alert(data.message);
    
    if (data.success) {
        currentFeaturedIndex = 0; // Сбрасываем фокус на первую новость
        loadNews(); // Перезагружаем список
    }
}
// === ПУБЛИКАЦИЯ / СОХРАНЕНИЕ ===
async function publishNews() {
    const title = document.getElementById('newsTitle').value;
    const isHtmlMode = document.getElementById('htmlToggle').checked;
    let content = isHtmlMode ? document.getElementById('html-editor').value : quill.root.innerHTML;
    const target = document.getElementById('postTarget').value; // 'news', 'wiki' или 'store'
    
    // --- ЛОГИКА СОХРАНЕНИЯ ТОВАРА В МАГАЗИН ---
    if (target === 'store') {
        const category = document.getElementById('storeCategory').value;
        const price = document.getElementById('storePrice').value;
        const days = document.getElementById('storeDays').value;
        const command = document.getElementById('storeCommand').value;

        if (!title || !price || !command) return alert('Заполните название, цену и команду сервера!');

        const res = await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: currentToken, category, name: title, description: content, price, days, command })
        });
        const data = await res.json();
        alert(data.message);
        if (data.success) {
            document.getElementById('newsTitle').value = '';
            quill.setContents([]);
            loadCategory(category, document.querySelector(`.cat-btn[onclick="loadCategory('${category}', this)"]`));
            switchTab('store', document.querySelectorAll('.tab-btn')[1]);
        }
        return; // Останавливаем выполнение, чтобы товар не сохранился как новость!
    }

    // --- ЛОГИКА СОХРАНЕНИЯ НОВОСТЕЙ И WIKI ---
    const d = new Date();
    const months = ["Января", "Февраля", "Марта", "Апреля", "Мая", "Июня", "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря"];
    const dateStr = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;

    if (!title || content.trim().length === 0 || content === '<p><br></p>') {
        return alert('Заполните заголовок и текст!');
    }

    let url = `/api/${target}`;
    let method = 'POST';
    
    if (editingPostId) {
        url = `/api/${editingPostType}/${editingPostId}`;
        method = 'PUT';
    }

    const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentToken, title, content, date: dateStr })
    });
    
    const data = await res.json();
    alert(data.message);
    
    if (data.success) {
        if (target === 'news') { currentFeaturedIndex = 0; loadNews(); } else { loadWiki(); }
        switchTab(target, document.querySelector(`.tab-btn[onclick="switchTab('${target}', this)"]`)); 
    }
}

// === КОММЕНТАРИИ ===
async function loadComments(newsId) {
    const list = document.getElementById('comments-list');
    const form = document.getElementById('comment-form');
    const countSpan = document.getElementById('comment-count');