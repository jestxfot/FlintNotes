/**
 * Icons drawn for this app, for notes of the kinds people keep: days, food,
 * media, study, money, health, travel, home. They are chosen in the icon picker
 * like any other, by names that start with `flint-`.
 *
 * Each is the inside of a 24x24 `<svg>` in the line style of the rest of the
 * icons: no fill, a round 2px stroke in the current colour.
 */
export const FLINT_ICONS: Record<string, { label: string; svg: string }> = {
  // ---- days and time
  'flint-sunrise': { label: 'утро день рассвет', svg: '<path d="M2 18h20"/><path d="M6 18a6 6 0 0 1 12 0"/><path d="M12 5v3"/><path d="M4.6 8.6l2.1 2.1"/><path d="M19.4 8.6l-2.1 2.1"/><path d="M8 21.5h8"/>' },
  'flint-night': { label: 'ночь вечер сон', svg: '<path d="M15 3.5a7.5 7.5 0 1 0 5.5 12.5A8.5 8.5 0 0 1 15 3.5z"/><path d="M4 5h4l-4 4h4"/><path d="M3 14h2.5L3 16.5h2.5"/>' },
  'flint-day-page': { label: 'ежедневная заметка день', svg: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4"/><path d="M16 2v4"/><path d="M4 9h16"/><circle cx="12" cy="15" r="2.5"/>' },
  'flint-week': { label: 'неделя', svg: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9v6"/><path d="M10.3 9v6"/><path d="M13.7 9v6"/><path d="M17 9v3"/>' },
  'flint-month-grid': { label: 'месяц календарь', svg: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M7.5 13h.01"/><path d="M12 13h.01"/><path d="M16.5 13h.01"/><path d="M7.5 17h.01"/><path d="M12 17h.01"/>' },
  'flint-year-ring': { label: 'год итоги', svg: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 3v4"/><path d="M12 12l3-2"/>' },
  'flint-hourglass-note': { label: 'срок дедлайн время', svg: '<path d="M6 3h12"/><path d="M6 21h12"/><path d="M7 3c0 5 10 5 10 9s-10 4-10 9"/><path d="M17 3c0 5-10 5-10 9"/><path d="M10 18.5h4"/>' },
  'flint-streak': { label: 'серия привычка подряд', svg: '<path d="M4 17l4-4 3 3 4-6 5 5"/><circle cx="4" cy="17" r="1"/><circle cx="8" cy="13" r="1"/><circle cx="11" cy="16" r="1"/><circle cx="15" cy="10" r="1"/><path d="M17 4l1 2 2 .3-1.500 1.400.400 2L17 8.800l-1.900.900.400-2L14 6.300 16 6z"/>' },

  // ---- food
  'flint-bowl-steam': { label: 'еда суп обед', svg: '<path d="M3 12h18a9 9 0 0 1-18 0z"/><path d="M8 3c-1 1.500 1 2.500 0 4"/><path d="M12 2c-1 1.500 1 2.500 0 4.500"/><path d="M16 3c-1 1.500 1 2.500 0 4"/>' },
  'flint-breakfast': { label: 'завтрак яичница', svg: '<path d="M12 4c5 0 9 3 9 7.500S17 20 12 20s-9-3-9-8 4-8 9-8z"/><circle cx="11" cy="12" r="3.200"/>' },
  'flint-dinner-plate': { label: 'ужин тарелка', svg: '<circle cx="13" cy="12" r="7"/><circle cx="13" cy="12" r="3.500"/><path d="M3 4v6a1.500 1.500 0 0 0 3 0V4"/><path d="M4.500 4v16"/>' },
  'flint-dumpling': { label: 'пельмени вареники', svg: '<path d="M3 15a9 9 0 0 1 18 0z"/><path d="M6 11.500l1.500 1.500"/><path d="M9.500 9.500l1 2"/><path d="M14.500 9.500l-1 2"/><path d="M18 11.500L16.500 13"/><path d="M5 18.500h14"/>' },
  'flint-pancakes': { label: 'блины оладьи', svg: '<ellipse cx="12" cy="8" rx="8" ry="3"/><path d="M4 8v4c0 1.700 3.600 3 8 3s8-1.300 8-3V8"/><path d="M4 12v4c0 1.700 3.600 3 8 3s8-1.300 8-3v-4"/><path d="M12 5v3l2 1"/>' },
  'flint-teapot': { label: 'чай напиток', svg: '<path d="M6 10h10v5a5 5 0 0 1-10 0z"/><path d="M16 11.500h2.500a2 2 0 0 1 0 4H16"/><path d="M6 12L3 10"/><path d="M9 10V8h4v2"/><path d="M11 5v1"/>' },
  'flint-jar': { label: 'банка соус заготовки', svg: '<rect x="7" y="3" width="10" height="3" rx="1"/><path d="M8 6c-1.500 1.500-2 2.500-2 4.500V19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8.500c0-2-.500-3-2-4.500"/><path d="M6 13h12"/>' },
  'flint-loaf': { label: 'хлеб выпечка тесто', svg: '<path d="M4 11a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4c0 1.300-.800 2-2 2.500V18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4.500C4.800 13 4 12.300 4 11z"/><path d="M10 7.500l-1 3"/><path d="M14 7.500l-1 3"/>' },
  'flint-cart-list': { label: 'покупки магазин список', svg: '<path d="M3 4h2.500l2 10h9.500l2-7H7"/><circle cx="9" cy="18.500" r="1.500"/><circle cx="16" cy="18.500" r="1.500"/><path d="M11 10h4"/>' },

  // ---- media
  'flint-play-card': { label: 'видео ролик youtube', svg: '<rect x="2.500" y="5" width="19" height="14" rx="4"/><path d="M10 9.500v5l4.500-2.500z"/>' },
  'flint-film-reel': { label: 'фильм кино', svg: '<circle cx="11" cy="11" r="8"/><circle cx="11" cy="7" r="1.300"/><circle cx="7" cy="11" r="1.300"/><circle cx="15" cy="11" r="1.300"/><circle cx="11" cy="15" r="1.300"/><path d="M17 17c1.500 2 3 3 5 3"/>' },
  'flint-series': { label: 'сериал эпизоды', svg: '<rect x="3" y="7" width="13" height="11" rx="2"/><path d="M7 7V5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3"/><path d="M8 10.500v4l3.500-2z"/>' },
  'flint-vinyl': { label: 'музыка альбом пластинка', svg: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.500"/><path d="M12 5.500a6.500 6.500 0 0 1 6.500 6.500"/><path d="M5.500 12A6.500 6.500 0 0 0 12 18.500"/>' },
  'flint-song-wave': { label: 'песня трек звук', svg: '<path d="M3 12v0"/><path d="M6.500 9v6"/><path d="M10 5v14"/><path d="M13.500 8v8"/><path d="M17 10.500v3"/><circle cx="20.500" cy="12" r=".500"/>' },
  'flint-podcast-mic': { label: 'подкаст запись голос', svg: '<rect x="9" y="3" width="6" height="10" rx="3"/><path d="M5.500 11a6.500 6.500 0 0 0 13 0"/><path d="M12 17.500V21"/><path d="M8.500 21h7"/>' },
  'flint-gamepad-pixel': { label: 'игра геймпад', svg: '<path d="M7 8h10a5 5 0 0 1 5 5v1a3 3 0 0 1-5.600 1.500L15.500 14h-7l-.900 1.500A3 3 0 0 1 2 14v-1a5 5 0 0 1 5-5z"/><path d="M7 10.500v3"/><path d="M5.500 12h3"/><path d="M16 11h.01"/><path d="M18 13h.01"/>' },
  'flint-pixel-block': { label: 'майнкрафт блок куб', svg: '<path d="M12 2.500l8.500 4.500v10L12 21.500 3.500 17V7z"/><path d="M3.500 7L12 11.500 20.500 7"/><path d="M12 11.500v10"/><path d="M7.500 9.200v4"/><path d="M16.500 13.500v3"/>' },
  'flint-ghost-story': { label: 'крипипаста миф страшилка', svg: '<path d="M5 21V10a7 7 0 0 1 14 0v11l-2.300-2-2.300 2-2.400-2-2.300 2-2.400-2z"/><path d="M9.500 10.500h.01"/><path d="M14.500 10.500h.01"/><path d="M10 14.500c1.300 1 2.700 1 4 0"/>' },
  'flint-mask': { label: 'персонаж роль театр', svg: '<path d="M4 5c5-1.500 11-1.500 16 0v6c0 5-3.500 8.500-8 9.500-4.500-1-8-4.500-8-9.500z"/><path d="M7.500 10c1-1 2-1 3 0"/><path d="M13.500 10c1-1 2-1 3 0"/><path d="M9 14.500c2 1.500 4 1.500 6 0"/>' },
  'flint-reaction': { label: 'реакция обзор мнение', svg: '<path d="M4 5h16v11H11l-5 4v-4H4z"/><path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M9.500 12.500c1.500 1.200 3.500 1.200 5 0"/>' },
  'flint-theory-web': { label: 'теория связи разбор', svg: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="12" cy="13" r="2.500"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6.700 7.300l3.500 4"/><path d="M17.300 8.200l-3.400 3.300"/><path d="M7.500 17.700l2.700-3"/><path d="M16.400 17.800l-2.600-3"/>' },

  // ---- knowledge
  'flint-book-leaf': { label: 'книга чтение', svg: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21a2 2 0 0 1 2-2h13v2H6"/><path d="M9 13c0-3.500 2-5.500 6-6-.300 4-2.300 6-6 6z"/>' },
  'flint-quote-card': { label: 'цитата', svg: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 14c1.500 0 2.500-1 2.500-2.500V9H8v2.500h2"/><path d="M14 14c1.500 0 2.500-1 2.500-2.500V9H14v2.500h2"/>' },
  'flint-lecture': { label: 'лекция курс учёба', svg: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.500V16c0 1.500 2.700 3 6 3s6-1.500 6-3v-4.500"/><path d="M22 9v6"/>' },
  'flint-flashcard': { label: 'карточки повторение память', svg: '<rect x="6" y="3" width="14" height="13" rx="2"/><path d="M4 7.500V19a2 2 0 0 0 2 2h11"/><path d="M11 8c.500-1.200 3.500-1.200 3.500.500 0 1.200-1.700 1.300-1.700 2.700"/><path d="M12.800 13.500h.01"/>' },
  'flint-idea-seed': { label: 'идея мысль росток', svg: '<path d="M12 21v-8"/><path d="M12 13c0-4 2.500-6.500 7-7 0 4.500-2.500 7-7 7z"/><path d="M12 16c0-3-2-5-6-5.500 0 3.500 2 5.500 6 5.500z"/><path d="M8 21h8"/>' },
  'flint-hub': { label: 'хаб оглавление карта', svg: '<circle cx="12" cy="12" r="3"/><path d="M12 3v6"/><path d="M12 15v6"/><path d="M3 12h6"/><path d="M15 12h6"/><circle cx="12" cy="3" r="1"/><circle cx="12" cy="21" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="21" cy="12" r="1"/>' },
  'flint-question-note': { label: 'вопрос неясно разобраться', svg: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M10 11.500c.300-1.800 4-1.800 4 .300 0 1.500-2 1.500-2 3.200"/><path d="M12 17.500h.01"/>' },
  'flint-draft': { label: 'черновик набросок', svg: '<path d="M5 3h9l5 5v5"/><path d="M5 3v18h6"/><path d="M14 3v5h5"/><path d="M14 21l1-3.500 5-5 2.500 2.500-5 5z"/>' },
  'flint-archive-box': { label: 'архив старое', svg: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M9.500 13h5"/><path d="M8 16.500h8"/>' },
  'flint-recipe': { label: 'рецепт готовка', svg: '<path d="M7 4h10a2 2 0 0 1 2 2v14l-3-2-2 2-2-2-2 2-3-2V6a2 2 0 0 1 2-2z"/><path d="M9 9h6"/><path d="M9 12.500h4"/><circle cx="16" cy="12.500" r=".600"/>' },
  'flint-code-note': { label: 'код программирование', svg: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 10l-2.500 2.500L9 15"/><path d="M15 10l2.500 2.500L15 15"/><path d="M13 9l-2 7"/>' },

  // ---- work and plans
  'flint-target-step': { label: 'цель задача', svg: '<circle cx="11" cy="13" r="8"/><circle cx="11" cy="13" r="4"/><path d="M11 13l8-8"/><path d="M16 4.500l3 .500.500 3"/>' },
  'flint-kanban-flag': { label: 'проект доска этап', svg: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="9.500" y="4" width="5" height="10" rx="1"/><path d="M17 20V4l4.500 2.500L17 9"/>' },
  'flint-meeting': { label: 'встреча созвон люди', svg: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9.500" r="2.300"/><path d="M2.500 19c.500-3.500 2.500-5.500 5.500-5.500s5 2 5.500 5.500"/><path d="M15 14.500c3-.500 5.500 1 6.500 4.500"/>' },
  'flint-inbox-drop': { label: 'входящие разобрать', svg: '<path d="M3 13l3-8h12l3 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 13h5.500a3.500 3.500 0 0 0 7 0H21"/><path d="M12 3v6"/><path d="M9.800 7l2.200 2.200L14.200 7"/>' },
  'flint-waiting': { label: 'ожидание пауза отложено', svg: '<circle cx="12" cy="12" r="9"/><path d="M9.500 8.500v7"/><path d="M14.500 8.500v7"/>' },
  'flint-done-stamp': { label: 'готово завершено', svg: '<path d="M4 12a8 8 0 1 0 8-8"/><path d="M4 4v4h4"/><path d="M8.500 12.500l2.500 2.500 4.500-5"/>' },

  // ---- money, health, people
  'flint-coin-stack': { label: 'деньги расходы бюджет', svg: '<ellipse cx="9" cy="7" rx="6" ry="2.500"/><path d="M3 7v4c0 1.400 2.700 2.500 6 2.500"/><path d="M3 11v4c0 1.400 2.700 2.500 6 2.500"/><ellipse cx="16" cy="15" rx="5" ry="2.200"/><path d="M11 15v3.500c0 1.200 2.200 2.200 5 2.200s5-1 5-2.200V15"/>' },
  'flint-receipt-tax': { label: 'налог счёт платёж', svg: '<path d="M6 3h12v18l-2-1.500-2 1.500-2-1.500-2 1.500-2-1.500-2 1.500z"/><path d="M9.500 14.500l5-6"/><circle cx="9.800" cy="9" r="1"/><circle cx="14.200" cy="14" r="1"/>' },
  'flint-pulse-heart': { label: 'здоровье самочувствие', svg: '<path d="M12 20.500C6 16 3 12.500 3 9a4.500 4.500 0 0 1 9-1 4.500 4.500 0 0 1 9 1c0 3.500-3 7-9 11.500z"/><path d="M5.500 12h3l1.500-2.500 2.500 5 1.500-2.500h4"/>' },
  'flint-dumbbell-mark': { label: 'спорт тренировка', svg: '<path d="M8 12h8"/><rect x="5" y="7" width="3" height="10" rx="1"/><rect x="16" y="7" width="3" height="10" rx="1"/><path d="M2.500 10v4"/><path d="M21.500 10v4"/>' },
  'flint-sleep-wave': { label: 'сон отдых', svg: '<path d="M3 17c2.500-3 4.500-3 6 0s3.500 3 6 0 3.500-3 6 0"/><path d="M13 4h5l-5 5h5"/><path d="M5 7h3l-3 3h3"/>' },
  'flint-person-card': { label: 'человек контакт', svg: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10.500" r="2.500"/><path d="M5.500 17c.500-2.200 1.700-3.200 3.500-3.200s3 1 3.500 3.200"/><path d="M15 10h3"/><path d="M15 13.500h3"/>' },
  'flint-birthday': { label: 'день рождения праздник', svg: '<path d="M4 20v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7z"/><path d="M4 16c2 1.500 3.500 1.500 5.300 0s3.400-1.500 5.400 0 3.300 1.500 5.300 0"/><path d="M12 11V7.500"/><path d="M12 3c1.200 1.300 1.200 2.500 0 3-1.200-.500-1.200-1.700 0-3z"/>' },

  // ---- places, home, things
  'flint-trip-pin': { label: 'поездка место путешествие', svg: '<path d="M12 21.500c4.500-4.500 7-8 7-11a7 7 0 0 0-14 0c0 3 2.500 6.500 7 11z"/><path d="M8.500 11.500l7-3-3 7-1-3z"/>' },
  'flint-home-key': { label: 'дом квартира', svg: '<path d="M3 11.500L12 4l9 7.500"/><path d="M5.500 10v10h13V10"/><circle cx="12" cy="13.500" r="1.800"/><path d="M12 15.300v3.200"/><path d="M12 17h1.500"/>' },
  'flint-land-plot': { label: 'земля участок дача', svg: '<path d="M3 17l6-3 6 3 6-3v4l-6 3-6-3-6 3z"/><path d="M12 11V4"/><path d="M12 4l4.500 2L12 8"/>' },
  'flint-car-side': { label: 'машина транспорт', svg: '<path d="M3 16v-3.500l2.500-1 2-4h7l3 4 3.500 1V16h-2"/><path d="M9 16h6"/><circle cx="7" cy="16.500" r="2"/><circle cx="17" cy="16.500" r="2"/><path d="M8.500 11.500h7"/>' },
  'flint-device': { label: 'техника устройство гаджет', svg: '<rect x="2.500" y="5" width="13" height="10" rx="1.500"/><path d="M6 19h6"/><path d="M9 15v4"/><rect x="17" y="9" width="5" height="10" rx="1.200"/><path d="M19.500 16.500h.01"/>' },
  'flint-wishlist': { label: 'желания хочу подарок', svg: '<path d="M12 8c-1-3-5-3.500-5-.500 0 1.500 2 2.500 5 .500z"/><path d="M12 8c1-3 5-3.500 5-.500 0 1.500-2 2.500-5 .500z"/><rect x="3.500" y="8" width="17" height="4" rx="1"/><path d="M5.500 12v8h13v-8"/><path d="M12 8v12"/>' },
  'flint-pet-paw': { label: 'питомец животное', svg: '<path d="M12 12.500c-3 0-5 2.500-5 4.800 0 1.700 1.500 2.200 3 1.700 1.300-.500 2.700-.500 4 0 1.500.500 3 0 3-1.700 0-2.300-2-4.800-5-4.800z"/><circle cx="6" cy="10" r="1.600"/><circle cx="9.700" cy="6.500" r="1.600"/><circle cx="14.300" cy="6.500" r="1.600"/><circle cx="18" cy="10" r="1.600"/>' },
  'flint-plant-pot': { label: 'растение сад', svg: '<path d="M7 14h10l-1.500 7h-7z"/><path d="M12 14V8"/><path d="M12 9c0-3 1.700-4.700 5-5 0 3.300-1.700 5-5 5z"/><path d="M12 11.500c0-2.300-1.400-3.700-4-4 0 2.600 1.400 4 4 4z"/>' },
  'flint-secret-lock': { label: 'личное секрет 18+', svg: '<rect x="5" y="10.500" width="14" height="10" rx="2"/><path d="M8 10.500V8a4 4 0 0 1 8 0v2.500"/><circle cx="12" cy="14.800" r="1.300"/><path d="M12 16v2"/>' },
  'flint-flint-spark': { label: 'flint кремень искра', svg: '<path d="M4 20l2.500-8L12 7l6 3.500-1.500 7L10 21z"/><path d="M12 7l1 6 5-2.500"/><path d="M13 13l-3 8"/><path d="M19 2v3.500"/><path d="M17.200 3.800h3.600"/>' },
}
