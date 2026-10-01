import { stem } from './normalize';

/**
 * Small bilingual vocabulary of UI concepts. Words in one group are treated
 * as near-synonyms by the clip matcher ("аналитика" ≈ "статистика" ≈ "stats").
 * Users never need to edit this; it only lifts confidence for typical
 * app-demo vocabulary. Matching still works for any other words via stems
 * and fuzzy comparison.
 */
const GROUPS: Record<string, string[]> = {
  home: ['главный', 'главная', 'главное', 'домашний', 'домашняя', 'стартовый', 'начальный', 'лента', 'дашборд', 'обзор', 'home', 'main', 'dashboard', 'feed', 'overview', 'start'],
  app: ['приложение', 'приложения', 'приложении', 'апп', 'сервис', 'app', 'application'],
  create: ['создать', 'создание', 'создадим', 'создаем', 'создаём', 'создавать', 'новый', 'новая', 'новую', 'добавить', 'добавление', 'добавим', 'добавляем', 'create', 'creating', 'new', 'add', 'adding'],
  task: ['задача', 'задачи', 'задачу', 'таск', 'дело', 'дела', 'туду', 'напоминание', 'task', 'tasks', 'todo', 'reminder'],
  stats: ['статистика', 'статистику', 'аналитика', 'аналитику', 'график', 'графики', 'диаграмма', 'отчет', 'отчеты', 'прогресс', 'показатели', 'метрики', 'stats', 'statistics', 'analytics', 'chart', 'charts', 'report', 'reports', 'progress', 'metrics', 'insights'],
  profile: ['профиль', 'аккаунт', 'учетная', 'учетной', 'пользователь', 'кабинет', 'аватар', 'profile', 'account', 'user', 'avatar'],
  settings: ['настройки', 'настройка', 'настроить', 'параметры', 'конфигурация', 'опции', 'settings', 'setting', 'preferences', 'options', 'config'],
  calendar: ['календарь', 'расписание', 'планирование', 'планировщик', 'дата', 'даты', 'неделя', 'месяц', 'calendar', 'schedule', 'planner', 'planning', 'date'],
  search: ['поиск', 'найти', 'искать', 'search', 'find'],
  notifications: ['уведомления', 'уведомление', 'оповещения', 'пуш', 'notifications', 'notification', 'alerts', 'push'],
  auth: ['вход', 'войти', 'логин', 'авторизация', 'регистрация', 'зарегистрироваться', 'пароль', 'login', 'signin', 'signup', 'register', 'password', 'auth'],
  chat: ['чат', 'сообщения', 'сообщение', 'переписка', 'мессенджер', 'chat', 'messages', 'message', 'inbox'],
  payment: ['оплата', 'оплатить', 'платеж', 'подписка', 'тариф', 'покупка', 'payment', 'pay', 'checkout', 'subscription', 'billing', 'purchase'],
  cart: ['корзина', 'корзину', 'cart', 'basket', 'bag'],
  catalog: ['каталог', 'товары', 'товар', 'магазин', 'продукты', 'catalog', 'shop', 'store', 'products', 'product'],
  order: ['заказ', 'заказы', 'доставка', 'order', 'orders', 'delivery'],
  onboarding: ['онбординг', 'приветствие', 'знакомство', 'обучение', 'onboarding', 'welcome', 'intro', 'tutorial'],
  edit: ['редактирование', 'редактировать', 'изменить', 'изменение', 'правка', 'edit', 'editing', 'change', 'modify'],
  delete: ['удалить', 'удаление', 'корзина', 'delete', 'remove', 'trash'],
  share: ['поделиться', 'отправить', 'шеринг', 'share', 'sharing', 'send'],
  list: ['список', 'списки', 'перечень', 'list', 'lists'],
  theme: ['тема', 'темная', 'тёмная', 'светлая', 'оформление', 'theme', 'dark', 'light', 'appearance'],
  photo: ['фото', 'фотография', 'камера', 'галерея', 'изображение', 'photo', 'camera', 'gallery', 'image'],
  map: ['карта', 'карте', 'маршрут', 'геолокация', 'map', 'route', 'location'],
  finance: ['бюджет', 'расходы', 'доходы', 'деньги', 'финансы', 'баланс', 'budget', 'expenses', 'income', 'money', 'finance', 'balance'],
  habits: ['привычка', 'привычки', 'трекер', 'цель', 'цели', 'habit', 'habits', 'tracker', 'goal', 'goals'],
  notes: ['заметка', 'заметки', 'записи', 'запись', 'note', 'notes'],
  widget: ['виджет', 'виджеты', 'widget', 'widgets'],
  filter: ['фильтр', 'фильтры', 'сортировка', 'filter', 'filters', 'sort'],
};

const stemToConcepts = new Map<string, Set<string>>();
for (const [concept, words] of Object.entries(GROUPS)) {
  for (const w of words) {
    const s = stem(w);
    if (!stemToConcepts.has(s)) stemToConcepts.set(s, new Set());
    stemToConcepts.get(s)!.add(concept);
  }
}

export function conceptsOfStem(s: string): Set<string> | undefined {
  return stemToConcepts.get(s);
}

export function shareConcept(a: string, b: string): boolean {
  const ca = stemToConcepts.get(a);
  const cb = stemToConcepts.get(b);
  if (!ca || !cb) return false;
  for (const c of ca) if (cb.has(c)) return true;
  return false;
}
