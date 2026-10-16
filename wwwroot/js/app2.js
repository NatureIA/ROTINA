(() => {
  const token = localStorage.getItem('routine_token');
  if (!token) { location.replace('/login.html'); return; }

  let activities = [];
  let allActivities = [];
  let executions = [];
  let todoTasks = [];
  let selected = new Date();
  selected.setHours(12, 0, 0, 0);

  let activeView = 'today';
  let todoScope = 'today';
  let todoActivity = '';
  let todoStatus = 'open';
  let todoSearch = '';
  let activeTaskId = null;

  const storedRoutineMode = localStorage.getItem('routine_structure_mode');
  let routineMode = ['calendar','kanban','list'].includes(storedRoutineMode) ? storedRoutineMode : 'calendar';
  let routineDate = new Date();
  routineDate.setHours(12, 0, 0, 0);
  let routineCalendarAutoScrollKey = '';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const pad = n => String(n).padStart(2, '0');
  const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const fmt = d => new Intl.DateTimeFormat('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' }).format(d);
  const short = d => new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'2-digit' }).format(d);
  const dayName = d => new Intl.DateTimeFormat('pt-BR', { weekday:'short' }).format(d).replace('.', '');
  const todayKey = () => key(new Date());
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  async function api(url, opt = {}) {
    const r = await fetch(url, {
      ...opt,
      headers: {
        'Content-Type':'application/json',
        Authorization:`Bearer ${token}`,
        ...(opt.headers || {})
      }
    });
    if (r.status === 401) {
      localStorage.clear();
      location.replace('/login.html');
      throw new Error('Sessão encerrada');
    }
    if (r.status === 204) return null;
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error(d?.message || 'Erro na operação');
    return d;
  }

  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 1900);
  }

  function days(a) {
    return String(a.days || '').split(',').filter(Boolean).map(Number);
  }

  function planned(a, d) {
    const k = key(d);
    const archivedKey = a.archivedAt ? key(new Date(a.archivedAt)) : null;
    const effectiveActive = a.archivedAt ? (a.archivedWasActive ?? true) : a.active;

    return effectiveActive &&
      (!archivedKey || k < archivedKey) &&
      (!a.startDate || k >= a.startDate) &&
      (!a.endDate || k <= a.endDate) &&
      days(a).includes(d.getDay());
  }

  function dayActivities(d) {
    return allActivities.filter(a => planned(a, d)).sort((a,b) => a.time.localeCompare(b.time));
  }

  function executionStatus(d, activityId) {
    return executions.find(e => e.date === key(d) && e.activityId === activityId)?.status || 'pending';
  }

  function linkedTasks(activityId, d) {
    const k = key(d);
    return todoTasks
      .filter(t => t.activityId === activityId && t.dueDate === k)
      .sort((a,b) =>
        String(a.dueTime || '99:99').localeCompare(String(b.dueTime || '99:99')) ||
        String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      );
  }

  function activityProgress(a, d) {
    const linked = linkedTasks(a.id, d);
    if (linked.length) {
      const done = linked.filter(t => taskDoneForDate(t, d)).length;
      return Math.round(done / linked.length * 100);
    }
    return executionStatus(d, a.id) === 'done' ? 100 : 0;
  }

  function adherence(d) {
    const list = dayActivities(d);
    if (!list.length) return 0;
    return Math.round(list.reduce((sum, a) => sum + activityProgress(a, d), 0) / list.length);
  }

  function avg(n, ref = new Date()) {
    const values = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = addDays(ref, -i);
      if (dayActivities(d).length) values.push(adherence(d));
    }
    return values.length ? Math.round(values.reduce((a,b) => a + b, 0) / values.length) : 0;
  }

  function streak(ref = selected) {
    let count = 0;
    for (let i = 0; i < 365; i++) {
      const d = addDays(ref, -i);
      if (!dayActivities(d).length) continue;
      if (adherence(d) >= 70) count++;
      else break;
    }
    return count;
  }

  function bestStreak() {
    let best = 0, current = 0;
    for (let i = 179; i >= 0; i--) {
      const d = addDays(new Date(), -i);
      if (!dayActivities(d).length) continue;
      if (adherence(d) >= 70) { current++; best = Math.max(best, current); }
      else current = 0;
    }
    return best;
  }

  function dur(minutes) {
    const m = +minutes || 0;
    const h = Math.floor(m / 60), r = m % 60;
    return h ? (r ? `${h}h ${r}min` : `${h}h`) : `${r}min`;
  }

  function endTimeFor(a) {
    const [hh,mm] = String(a.time || '00:00').split(':').map(Number);
    const total = ((hh || 0) * 60 + (mm || 0) + (+a.durationMinutes || 0)) % (24 * 60);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }

  function timeMinutes(v) {
    const [h,m] = String(v || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function durationFromRange() {
    const start = $('#activityTime').value;
    const end = $('#activityEndTime').value;
    if (!start || !end) return 0;
    let diff = timeMinutes(end) - timeMinutes(start);
    if (diff < 0) diff += 24 * 60;
    return diff;
  }

  function updateDurationPreview() {
    const total = durationFromRange();
    $('#durationPreview').textContent = total ? `${dur(total)} de duração` : 'Defina o horário final';
  }

  function syncEndDate() {
    const noEnd = $('#activityNoEnd').checked;
    $('#activityEnd').disabled = noEnd;
    if (noEnd) $('#activityEnd').value = '';
  }

  function completionDateKey(task) {
    if (!task?.completedAt) return '';
    const d = new Date(task.completedAt);
    return Number.isNaN(d.getTime()) ? '' : key(d);
  }

  function taskDoneForDate(task, d) {
    if (task?.status !== 'done') return false;
    const completed = completionDateKey(task);
    return !completed || completed <= key(d);
  }

  function statusLabel(status) {
    return ({pending:'A fazer', progress:'Em andamento', done:'Concluída', skipped:'Não realizada'})[status] || status;
  }

  function priorityLabel(priority) {
    return ({low:'Baixa', medium:'Média', high:'Alta'})[priority] || 'Média';
  }

  function activityName(id) {
    return allActivities.find(a => a.id === id)?.title || '';
  }

  function taskActivityName(task) {
    return activityName(task?.activityId) || task?.activityTitle || '';
  }

  function renderBars(selector, n, ref, dates = false) {
    const arr = [];
    for (let i = n - 1; i >= 0; i--) arr.push(addDays(ref, -i));
    $(selector).innerHTML = arr.map(d => {
      const value = adherence(d);
      return `<div class="barcol"><div class="track"><div class="bar" style="height:${Math.max(value, 2)}%"></div></div><small>${value}%</small><small>${dates ? short(d) : dayName(d)}</small></div>`;
    }).join('');
  }

  function categoryStats(ref, n) {
    const map = {};
    for (let i = n - 1; i >= 0; i--) {
      const d = addDays(ref, -i);
      dayActivities(d).forEach(a => {
        const name = a.category || 'Outros';
        map[name] ??= { sum:0, count:0 };
        map[name].sum += activityProgress(a, d);
        map[name].count++;
      });
    }
    return Object.entries(map)
      .map(([name,v]) => ({ name, pct: v.count ? Math.round(v.sum / v.count) : 0 }))
      .sort((a,b) => b.pct - a.pct);
  }

  function renderCategories() {
    const rows = categoryStats(selected, 7);
    $('#categoryPerformance').innerHTML = rows.length
      ? rows.map(x => `<div class="meterrow"><div class="metertop"><span>${esc(x.name)}</span><span>${x.pct}%</span></div><div class="meter"><i style="width:${x.pct}%"></i></div></div>`).join('')
      : '<div class="empty">Sem dados suficientes.</div>';
  }

  function renderFocus() {
    const list = dayActivities(selected);
    const isToday = key(selected) === todayKey();
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    let current = null;
    let next = null;

    if (isToday) {
      current = list.find(a => {
        const start = timeMinutes(a.time);
        return nowMinutes >= start && nowMinutes < start + (+a.durationMinutes || 0);
      }) || null;
      next = list.find(a => timeMinutes(a.time) > nowMinutes) || null;
    } else {
      next = list[0] || null;
    }

    $('#currentFocus').innerHTML = focusHtml('AGORA', current, selected, true);
    $('#nextFocus').innerHTML = focusHtml(isToday ? 'PRÓXIMO' : 'PRIMEIRO DO DIA', next, selected, false);

    $$('#currentFocus [data-focus-tasks], #nextFocus [data-focus-tasks]').forEach(b => {
      b.onclick = () => openTasksForActivity(b.dataset.focusTasks);
    });
    $$('#currentFocus [data-focus-task], #nextFocus [data-focus-task]').forEach(b => {
      b.onclick = () => openTaskDrawer(b.dataset.focusTask);
    });
    $$('#currentFocus [data-focus-done], #nextFocus [data-focus-done]').forEach(b => {
      b.onclick = () => setExecution(b.dataset.focusDone, 'done');
    });
  }

  function focusHtml(label, activity, d, current) {
    if (!activity) {
      return `<span class="focus-label">${label}</span><strong>${current ? 'Nenhuma atividade em andamento' : 'Nada programado a seguir'}</strong><p>Seu próximo passo aparecerá aqui.</p>`;
    }
    const linked = linkedTasks(activity.id, d);
    const progress = activityProgress(activity, d);
    const nextTask = linked.find(t => ['pending','progress'].includes(t.status)) || null;

    const archived = !!activity.archivedAt;
    const action = nextTask
      ? `<button class="focus-action" data-focus-task="${nextTask.id}">Abrir próxima tarefa</button>`
      : linked.length
        ? `<button class="focus-action" data-focus-tasks="${activity.id}">Ver tarefas</button>`
        : archived
          ? '<span class="focus-done">Rotina arquivada</span>'
          : progress === 100
            ? '<span class="focus-done">Concluída</span>'
            : `<button class="focus-action" data-focus-done="${activity.id}">Concluir atividade</button>`;

    const nextTaskText = nextTask
      ? `<div class="focus-next-task"><span>Próxima tarefa</span><strong>${esc(nextTask.title)}</strong>${nextTask.dueTime ? `<small>${nextTask.dueTime}</small>` : ''}</div>`
      : '';

    return `<span class="focus-label">${label}</span>
      <div class="focus-title"><strong>${esc(activity.title)}</strong><span>${activity.time} → ${endTimeFor(activity)}</span></div>
      <p>${esc(activity.category)}${linked.length ? ` · ${linked.filter(t => taskDoneForDate(t, d)).length}/${linked.length} tarefas concluídas no prazo do dia` : ''}</p>
      ${nextTaskText}
      <div class="focus-progress"><i style="width:${progress}%"></i></div>
      <div class="focus-bottom"><span>${progress}%</span>${action}</div>`;
  }

  function renderToday() {
    const list = dayActivities(selected);
    const completed = list.filter(a => activityProgress(a, selected) === 100).length;

    $('#selectedDate').textContent = fmt(selected);
    $('#kpiAdherence').textContent = adherence(selected) + '%';
    $('#kpiCompleted').textContent = `${completed}/${list.length}`;
    $('#kpiStreak').textContent = streak(selected);
    $('#kpiTime').textContent = dur(list.reduce((s,a) => s + (+a.durationMinutes || 0), 0));

    renderFocus();

    $('#todayActivities').innerHTML = list.length ? list.map(a => {
      const linked = linkedTasks(a.id, selected);
      const done = linked.filter(t => taskDoneForDate(t, selected)).length;
      const progress = activityProgress(a, selected);
      const st = executionStatus(selected, a.id);

      const archived = !!a.archivedAt;
      const actions = archived
        ? (linked.length
            ? `<div class="activity-actions"><button class="btn activity-task-btn" data-open-tasks="${a.id}">Ver tarefas históricas <span>${done}/${linked.length}</span></button></div>`
            : '<span class="archived-label">Rotina arquivada</span>')
        : linked.length
          ? `<div class="activity-actions">
              <button class="btn activity-task-btn" data-open-tasks="${a.id}">Abrir tarefas <span>${done}/${linked.length}</span></button>
              <button class="mini" data-new-task-activity="${a.id}">+ Tarefa</button>
            </div>`
          : `<div class="activity-actions activity-status-actions">
              <button
                class="mini orange activity-status-choice status-progress ${st !== 'pending' && st !== 'progress' ? 'is-muted' : ''} ${st === 'progress' ? 'is-selected' : ''}"
                data-activity-status="progress"
                data-activity-id="${a.id}"
                aria-pressed="${st === 'progress'}">Iniciar</button>
              <button
                class="mini good activity-status-choice status-done ${st !== 'pending' && st !== 'done' ? 'is-muted' : ''} ${st === 'done' ? 'is-selected' : ''}"
                data-activity-status="done"
                data-activity-id="${a.id}"
                aria-pressed="${st === 'done'}">Concluir</button>
              <button
                class="mini red activity-status-choice status-skipped ${st !== 'pending' && st !== 'skipped' ? 'is-muted' : ''} ${st === 'skipped' ? 'is-selected' : ''}"
                data-activity-status="skipped"
                data-activity-id="${a.id}"
                aria-pressed="${st === 'skipped'}">Não realizada</button>
              <button class="mini" data-new-task-activity="${a.id}">+ Tarefa</button>
            </div>`;

      return `<div class="day-activity ${st}">
        <div class="activity-time"><strong>${a.time}</strong><span>${endTimeFor(a)}</span></div>
        <div class="activity-main ${linked.length ? 'clickable' : ''}" ${linked.length ? `data-card-open-tasks="${a.id}"` : ''}>
          <div class="activity-heading"><div><strong>${esc(a.title)}</strong><p>${esc(a.category)} · ${a.type === 'habit' ? 'Hábito' : 'Rotina'}</p></div><b>${progress}%</b></div>
          <div class="activity-progress"><i style="width:${progress}%"></i></div>
          <div class="activity-meta">${archived ? 'Rotina arquivada · ' : ''}${linked.length ? `${done} de ${linked.length} tarefas concluídas` : `Conclusão manual · ${dur(a.durationMinutes)}`}</div>
        </div>
        <div class="activity-card-actions">${actions}</div>
      </div>`;
    }).join('') : '<div class="empty">Nenhuma atividade planejada para este dia.</div>';

    $$('[data-open-tasks]').forEach(b => b.onclick = () => openTasksForActivity(b.dataset.openTasks));
    $$('[data-card-open-tasks]').forEach(b => b.onclick = () => openTasksForActivity(b.dataset.cardOpenTasks));
    $$('[data-new-task-activity]').forEach(b => b.onclick = () => openTaskModal('', b.dataset.newTaskActivity));
    $$('[data-activity-status]').forEach(b => b.onclick = () => setExecution(b.dataset.activityId, b.dataset.activityStatus));

    renderBars('#weeklyChart', 7, selected);
    $('#weekAverage').textContent = avg(7, selected) + '% média';
    renderCategories();
  }

  function routineDateText(d) {
    const text = new Intl.DateTimeFormat('pt-BR', {
      weekday:'long',
      day:'2-digit',
      month:'long'
    }).format(d);
    return key(d) === todayKey() ? `Hoje · ${text}` : text;
  }

  function routineModeDateAware() {
    return routineMode === 'calendar' || routineMode === 'list';
  }

  function renderRoutineToolbar() {
    $('[data-routine-mode]').forEach(button => {
      const active = button.dataset.routineMode === routineMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const toolbar = $('#routineDateToolbar');
    toolbar.hidden = !routineModeDateAware();
    $('#routineDateLabel').textContent = routineDateText(routineDate);
  }

  function archiveRoutineActivity(id) {
    return (async () => {
      if (!confirm('Arquivar esta rotina? Ela sairá da sua rotina ativa, mas o histórico e as tarefas serão preservados.')) return;

      const archived = activities.find(x => x.id === id);
      await api('/api/activities/' + id, { method:'DELETE' });

      todoTasks.forEach(t => {
        if (t.activityId === id && !t.activityTitle) t.activityTitle = archived?.title || '';
      });

      if (archived) {
        const archivedSnapshot = {
          ...archived,
          archivedWasActive: archived.active,
          active:false,
          archivedAt:new Date().toISOString()
        };
        allActivities = allActivities.filter(x => x.id !== id);
        allActivities.push(archivedSnapshot);
      }

      activities = activities.filter(x => x.id !== id);
      renderAll();
      toast('Rotina arquivada; histórico preservado');
    })();
  }

  function bindRoutineActions() {
    $$('[data-edit-activity]').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        openActivityModal(b.dataset.editActivity);
      };
    });

    $$('[data-routine-new-task]').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        openTaskModal('', b.dataset.routineNewTask);
      };
    });

    $$('[data-routine-tasks], [data-calendar-tasks], [data-list-tasks]').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        const id = b.dataset.routineTasks || b.dataset.calendarTasks || b.dataset.listTasks;
        openTasksForActivity(id);
      };
    });

    $$('[data-toggle-activity]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const a = activities.find(x => x.id === b.dataset.toggleActivity);
      if (!a) return;
      await saveActivity({...a, active:!a.active});
      toast('Atividade atualizada');
    });

    $$('[data-delete-activity]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      await archiveRoutineActivity(b.dataset.deleteActivity);
    });
  }

  function routineKanbanHtml() {
    const names = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

    return activities.length
      ? [...activities].sort((a,b) => a.time.localeCompare(b.time)).map(a => {
          const openTasks = todoTasks.filter(t => t.activityId === a.id && !['done','skipped'].includes(t.status)).length;

          return `<div class="routinecard ${a.active ? '' : 'paused'}">
            <div class="routinetop">
              <div><strong>${esc(a.title)}</strong><p>${esc(a.category)} · ${a.type === 'habit' ? 'Hábito' : 'Rotina'}</p></div>
              <strong>${a.time} → ${endTimeFor(a)}</strong>
            </div>
            <p>${days(a).map(x => names[x]).join(', ')} · ${dur(a.durationMinutes)}${a.endDate ? ` · até ${fromKey(a.endDate).toLocaleDateString('pt-BR')}` : ' · sem data final'}</p>
            <div class="routine-task-summary">
              <span>${openTasks} tarefa${openTasks === 1 ? '' : 's'} pendente${openTasks === 1 ? '' : 's'}</span>
              <div class="routine-inline-actions">
                <button class="mini" data-routine-new-task="${a.id}">+ Tarefa</button>
                <button class="mini orange" data-routine-tasks="${a.id}">Ver tarefas</button>
              </div>
            </div>
            <div class="routines">
              <button class="mini" data-edit-activity="${a.id}">Editar</button>
              <button class="mini orange" data-toggle-activity="${a.id}">${a.active ? 'Pausar' : 'Ativar'}</button>
              <button class="mini red" data-delete-activity="${a.id}">Arquivar</button>
            </div>
          </div>`;
        }).join('')
      : '<div class="empty">Sua rotina está vazia.</div>';
  }

  function routineListHtml() {
    const list = dayActivities(routineDate);
    if (!list.length) return '<div class="empty">Nenhuma atividade planejada para este dia.</div>';

    return `<div class="routine-list-table">
      ${list.map(a => {
        const linked = linkedTasks(a.id, routineDate);
        const done = linked.filter(t => taskDoneForDate(t, routineDate)).length;
        const progress = activityProgress(a, routineDate);
        const current = activities.some(x => x.id === a.id);

        return `<article class="routine-list-row">
          <div class="routine-list-time">
            <strong>${a.time}</strong>
            <span>${endTimeFor(a)}</span>
          </div>
          <div class="routine-list-main">
            <strong>${esc(a.title)}</strong>
            <span>${esc(a.category)} · ${a.type === 'habit' ? 'Hábito' : 'Rotina'} · ${dur(a.durationMinutes)}</span>
          </div>
          <div class="routine-list-progress">
            <div><i style="width:${progress}%"></i></div>
            <span>${linked.length ? `${done}/${linked.length} tarefas` : `${progress}% concluído`}</span>
          </div>
          <div class="routine-list-actions">
            <button class="mini orange" data-list-tasks="${a.id}">Ver tarefas</button>
            ${current ? `<button class="mini" data-edit-activity="${a.id}">Editar</button>` : '<span class="archived-label">Arquivada</span>'}
          </div>
        </article>`;
      }).join('')}
    </div>`;
  }

  function calendarLayout(items) {
    const source = items.map(a => {
      const start = timeMinutes(a.time);
      const end = Math.min(24 * 60, start + Math.max(5, +a.durationMinutes || 0));
      return {activity:a, start, end};
    }).sort((a,b) => a.start - b.start || a.end - b.end);

    const clusters = [];
    let cluster = [];
    let clusterEnd = -1;

    source.forEach(event => {
      if (!cluster.length || event.start < clusterEnd) {
        cluster.push(event);
        clusterEnd = Math.max(clusterEnd, event.end);
      } else {
        clusters.push(cluster);
        cluster = [event];
        clusterEnd = event.end;
      }
    });
    if (cluster.length) clusters.push(cluster);

    const laidOut = [];
    clusters.forEach(group => {
      const laneEnds = [];

      group.forEach(event => {
        let lane = laneEnds.findIndex(end => end <= event.start);
        if (lane === -1) lane = laneEnds.length;
        laneEnds[lane] = event.end;
        event.lane = lane;
      });

      const laneCount = Math.max(1, laneEnds.length);
      group.forEach(event => laidOut.push({...event, laneCount}));
    });

    return laidOut;
  }

  function routineCalendarRange(items) {
    if (!items.length) return {startHour:6, endHour:22};

    const starts = items.map(a => timeMinutes(a.time));
    const ends = items.map(a => Math.min(24 * 60, timeMinutes(a.time) + Math.max(5, +a.durationMinutes || 0)));

    const earliest = Math.floor(Math.min(...starts) / 60) - 1;
    const latest = Math.ceil(Math.max(...ends) / 60) + 1;

    return {
      startHour:Math.max(0, Math.min(6, earliest)),
      endHour:Math.min(24, Math.max(22, latest))
    };
  }

  function routineCalendarHtml() {
    const list = dayActivities(routineDate);
    const range = routineCalendarRange(list);
    const hourPx = window.innerWidth <= 760 ? 64 : 72;
    const startMinute = range.startHour * 60;
    const endMinute = range.endHour * 60;
    const totalHeight = (range.endHour - range.startHour) * hourPx;
    const layout = calendarLayout(list);
    const now = new Date();
    const today = key(routineDate) === todayKey();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const hours = [];
    for (let h = range.startHour; h <= range.endHour; h++) {
      const y = (h - range.startHour) * hourPx;
      hours.push(`<span class="routine-hour-label" style="top:${y}px">${pad(h)}:00</span>`);
    }

    const lines = [];
    for (let h = range.startHour; h <= range.endHour; h++) {
      const y = (h - range.startHour) * hourPx;
      lines.push(`<i class="routine-hour-line" style="top:${y}px"></i>`);
      if (h < range.endHour) lines.push(`<i class="routine-half-line" style="top:${y + hourPx / 2}px"></i>`);
    }

    const events = layout.map(({activity:a,start,end,lane,laneCount}) => {
      const top = ((start - startMinute) / 60) * hourPx;
      const rawHeight = ((end - start) / 60) * hourPx;
      const height = Math.max(42, rawHeight - 3);
      const linked = linkedTasks(a.id, routineDate);
      const done = linked.filter(t => taskDoneForDate(t, routineDate)).length;
      const progress = activityProgress(a, routineDate);
      const isNow = today && nowMinutes >= start && nowMinutes < end;
      const left = lane * (100 / laneCount);
      const width = 100 / laneCount;
      const compact = height < 82 ? 'compact' : '';

      return `<button type="button"
        class="routine-calendar-event ${isNow ? 'is-now' : ''} ${compact}"
        data-calendar-tasks="${a.id}"
        style="top:${top}px;height:${height}px;left:calc(${left}% + 4px);width:calc(${width}% - 8px)"
        aria-label="${esc(a.title)}, ${a.time} até ${endTimeFor(a)}">
          <div class="routine-calendar-event-head">
            <strong>${esc(a.title)}</strong>
            <span>${a.time}–${endTimeFor(a)}</span>
          </div>
          <small>${esc(a.category)}${linked.length ? ` · ${done}/${linked.length} tarefas` : ''}</small>
          <div class="routine-calendar-event-progress"><i style="width:${progress}%"></i></div>
        </button>`;
    }).join('');

    return `<div class="routine-calendar-shell" id="routineCalendarScroll">
      <div class="routine-calendar-grid" style="height:${totalHeight}px">
        <div class="routine-calendar-hours" style="height:${totalHeight}px">${hours.join('')}</div>
        <div class="routine-calendar-stage"
             id="routineCalendarStage"
             data-start-minute="${startMinute}"
             data-end-minute="${endMinute}"
             data-hour-px="${hourPx}"
             style="height:${totalHeight}px">
          ${lines.join('')}
          <div class="routine-calendar-events">${events}</div>
          <div class="routine-now-line" id="routineNowLine" hidden><span></span></div>
        </div>
      </div>
      ${list.length ? '' : '<div class="routine-calendar-empty">Nenhuma atividade planejada para este dia.</div>'}
    </div>`;
  }

  function updateRoutineCurrentTimeLine() {
    const line = $('#routineNowLine');
    const stage = $('#routineCalendarStage');
    if (!line || !stage || routineMode !== 'calendar') return;

    const today = key(routineDate) === todayKey();
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    const startMinute = +stage.dataset.startMinute;
    const endMinute = +stage.dataset.endMinute;
    const hourPx = +stage.dataset.hourPx;

    if (!today || minute < startMinute || minute > endMinute) {
      line.hidden = true;
      return;
    }

    line.hidden = false;
    line.style.top = (((minute - startMinute) / 60) * hourPx) + 'px';
    line.querySelector('span').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  function autoScrollRoutineCalendar() {
    if (routineMode !== 'calendar' || key(routineDate) !== todayKey()) return;

    const scroller = $('#routineCalendarScroll');
    const stage = $('#routineCalendarStage');
    if (!scroller || !stage) return;

    const autoKey = `${key(routineDate)}-${routineMode}`;
    if (routineCalendarAutoScrollKey === autoKey) return;

    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    const startMinute = +stage.dataset.startMinute;
    const endMinute = +stage.dataset.endMinute;
    const hourPx = +stage.dataset.hourPx;

    if (minute < startMinute || minute > endMinute) return;

    const top = ((minute - startMinute) / 60) * hourPx;
    scroller.scrollTop = Math.max(0, top - scroller.clientHeight * .34);
    routineCalendarAutoScrollKey = autoKey;
  }

  function renderRoutine() {
    renderRoutineToolbar();

    const container = $('#routineList');

    if (routineMode === 'kanban') {
      container.className = 'routinegrid';
      container.innerHTML = routineKanbanHtml();
    } else if (routineMode === 'list') {
      container.className = 'routine-list-view';
      container.innerHTML = routineListHtml();
    } else {
      container.className = 'routine-calendar-view';
      container.innerHTML = routineCalendarHtml();
      requestAnimationFrame(() => {
        updateRoutineCurrentTimeLine();
        autoScrollRoutineCalendar();
      });
    }

    bindRoutineActions();
  }

  function renderHabits() {
    const habits = activities.filter(a => a.type === 'habit' && a.active);
    $('#habitList').innerHTML = habits.length ? habits.map(a => {
      const values = [];
      for (let i = 6; i >= 0; i--) {
        const d = addDays(new Date(), -i);
        if (planned(a, d)) values.push(activityProgress(a, d) === 100);
      }
      const done = values.filter(Boolean).length;
      const pct = values.length ? Math.round(done / values.length * 100) : 0;
      return `<div class="habitcard"><div><strong>${esc(a.title)}</strong><small>${esc(a.category)} · ${done}/${values.length} dias completos</small><div class="dots">${values.map(x => `<i class="${x ? 'on' : ''}"></i>`).join('')}</div></div><div class="score">${pct}%</div></div>`;
    }).join('') : '<div class="empty">Nenhum hábito configurado.</div>';
  }

  function performancePeriodStats(ref, count = 30, endOffset = 0) {
    const daysInPeriod = [];
    let totalActivities = 0;
    let completedActivities = 0;
    let plannedDays = 0;
    let consistentDays = 0;
    let adherenceSum = 0;

    for (let i = count - 1 + endOffset; i >= endOffset; i--) {
      const d = addDays(ref, -i);
      const list = dayActivities(d);
      const value = list.length ? adherence(d) : null;

      if (list.length) {
        plannedDays++;
        adherenceSum += value;
        if (value >= 70) consistentDays++;

        list.forEach(a => {
          totalActivities++;
          if (activityProgress(a, d) === 100) completedActivities++;
        });
      }

      daysInPeriod.push({
        date:d,
        value,
        status:!list.length ? 'none' : value === 100 ? 'perfect' : value > 0 ? 'partial' : 'low'
      });
    }

    return {
      adherence:plannedDays ? Math.round(adherenceSum / plannedDays) : 0,
      totalActivities,
      completedActivities,
      plannedDays,
      consistentDays,
      days:daysInPeriod
    };
  }

  function signedPercent(value) {
    return `${value > 0 ? '+' : ''}${value}%`;
  }

  function performanceMotivation(stats, evolution, sequence) {
    const record = bestStreak();

    if (sequence > 0 && sequence === record) {
      return {
        title:'Seu melhor ritmo até agora.',
        detail:`${sequence} dia${sequence === 1 ? '' : 's'} de sequência — novo recorde pessoal.`
      };
    }

    if (stats.adherence >= 90) {
      return {
        title:'Um ritmo excelente.',
        detail:`Você cumpriu ${stats.adherence}% do que planejou nos últimos 30 dias.`
      };
    }

    if (evolution > 0) {
      return {
        title:'Seu ritmo está evoluindo.',
        detail:`${signedPercent(evolution)} em relação aos 30 dias anteriores.`
      };
    }

    if (stats.adherence >= 70) {
      return {
        title:'Você está mantendo um bom ritmo.',
        detail:`${stats.consistentDays} de ${stats.plannedDays || 0} dias planejados foram consistentes.`
      };
    }

    return {
      title:'Cada dia conta.',
      detail:'Retome o ritmo aos poucos e mantenha o foco no que você planejou.'
    };
  }

  function renderPerformance() {
    const ref = new Date();
    const current = performancePeriodStats(ref, 30, 0);
    const previous = performancePeriodStats(ref, 30, 30);
    const evolution = current.adherence - previous.adherence;
    const sequence = streak(ref);
    const motivation = performanceMotivation(current, evolution, sequence);

    $('#perfAdherence').textContent = current.adherence + '%';
    $('#perfRingValue').textContent = current.adherence + '%';
    $('#perfRing').style.setProperty('--value', current.adherence);
    $('#perfAdherenceText').textContent = current.plannedDays
      ? `Você cumpriu ${current.adherence}% do que planejou nos últimos 30 dias.`
      : 'Comece a registrar sua rotina para acompanhar sua aderência.';

    const evolutionChip = $('#perfEvolutionChip');
    evolutionChip.textContent = signedPercent(evolution) + ' vs. período anterior';
    evolutionChip.classList.toggle('positive', evolution > 0);
    evolutionChip.classList.toggle('negative', evolution < 0);
    evolutionChip.classList.toggle('neutral', evolution === 0);

    $('#perfCompleted').textContent = `${current.completedActivities}/${current.totalActivities}`;
    $('#perfSequence').textContent = `${sequence} dia${sequence === 1 ? '' : 's'}`;
    $('#perfConsistency').textContent = `${current.consistentDays}/${current.plannedDays}`;
    $('#perfEvolutionMobile').textContent = signedPercent(evolution);
    $('#perfEvolutionMobile').classList.toggle('positive', evolution > 0);
    $('#perfEvolutionMobile').classList.toggle('negative', evolution < 0);

    $('#perfMotivation').textContent = motivation.title;
    $('#perfMotivationDetail').textContent = motivation.detail;

    $('#perfMonthStrip').innerHTML = current.days.map(day => {
      const label = day.value === null
        ? `${short(day.date)} · sem atividade planejada`
        : `${short(day.date)} · ${day.value}% de aderência`;

      return `<div class="performance-day" title="${esc(label)}">
        <span class="${day.status}"></span>
        <small>${day.date.getDate()}</small>
      </div>`;
    }).join('');
  }

  function roundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawSystemShareBackground(ctx, width, height) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#17191c');
    sky.addColorStop(.18, '#101214');
    sky.addColorStop(.36, '#0b0c0e');
    sky.addColorStop(.47, '#1a100a');
    sky.addColorStop(.58, '#0c0d0e');
    sky.addColorStop(1, '#070809');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const horizon = ctx.createRadialGradient(width * .82, height * .405, 12, width * .82, height * .405, width * .62);
    horizon.addColorStop(0, 'rgba(255,179,78,.95)');
    horizon.addColorStop(.10, 'rgba(255,124,28,.68)');
    horizon.addColorStop(.28, 'rgba(220,72,8,.34)');
    horizon.addColorStop(.52, 'rgba(116,39,8,.14)');
    horizon.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = horizon;
    ctx.fillRect(0, height * .18, width, height * .48);

    const cloudY = height * .37;
    const cloudGrad = ctx.createLinearGradient(0, cloudY - 80, 0, cloudY + 140);
    cloudGrad.addColorStop(0, 'rgba(94,34,15,0)');
    cloudGrad.addColorStop(.45, 'rgba(125,43,14,.12)');
    cloudGrad.addColorStop(.70, 'rgba(255,100,16,.12)');
    cloudGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cloudGrad;
    for (let i = 0; i < 11; i++) {
      ctx.beginPath();
      ctx.ellipse(620 + i * 55, cloudY + (i % 3) * 15, 125, 28, -.10, 0, Math.PI * 2);
      ctx.fill();
    }

    const sunX = width * .835;
    const sunY = height * .445;
    const sunR = 55;
    const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 150);
    halo.addColorStop(0, 'rgba(255,226,158,.90)');
    halo.addColorStop(.28, 'rgba(255,147,53,.55)');
    halo.addColorStop(1, 'rgba(255,111,24,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(sunX - 170, sunY - 170, 340, 340);
    ctx.fillStyle = '#ffbb64';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();

    function mountain(points, fill, shadowColor = null, shadowBlur = 0) {
      ctx.save();
      if (shadowColor) {
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = shadowBlur;
      }
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(0, height * .52);
      points.forEach(([x,y]) => ctx.lineTo(width * x, height * y));
      ctx.lineTo(width, height * .57);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    mountain([
      [.00,.475],[.055,.462],[.10,.435],[.15,.402],[.20,.462],[.25,.443],[.30,.483],
      [.36,.448],[.42,.493],[.49,.457],[.56,.505],[.63,.472],[.70,.508],[.77,.480],
      [.83,.502],[.89,.437],[.94,.405],[1,.458]
    ], '#171819', 'rgba(255,101,16,.12)', 30);

    mountain([
      [.00,.510],[.06,.485],[.12,.455],[.18,.508],[.24,.478],[.31,.523],[.38,.489],
      [.46,.534],[.54,.495],[.62,.540],[.70,.507],[.78,.538],[.86,.490],[.93,.462],[1,.520]
    ], '#0d0e0f');

    mountain([
      [.00,.545],[.07,.515],[.15,.487],[.23,.548],[.31,.512],[.40,.562],[.49,.526],
      [.58,.568],[.67,.535],[.76,.570],[.84,.535],[.92,.505],[1,.558]
    ], '#070809');

    ctx.strokeStyle = 'rgba(255,119,28,.20)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(width * .80, height * .515);
    ctx.lineTo(width * .89, height * .437);
    ctx.lineTo(width * .94, height * .405);
    ctx.stroke();

    const vignette = ctx.createRadialGradient(width / 2, height * .43, width * .08, width / 2, height * .43, width * .78);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(.72, 'rgba(0,0,0,.10)');
    vignette.addColorStop(1, 'rgba(0,0,0,.74)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  function drawImageCover(ctx, image, width, height) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = (image.naturalWidth - sourceWidth) / 2;
    const sourceY = (image.naturalHeight - sourceHeight) / 2;

    ctx.save();
    ctx.filter = 'brightness(.52) saturate(.88) contrast(1.08)';
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    ctx.restore();

    const overlay = ctx.createLinearGradient(0, 0, 0, height);
    overlay.addColorStop(0, 'rgba(7,8,10,.60)');
    overlay.addColorStop(.35, 'rgba(7,8,10,.26)');
    overlay.addColorStop(.68, 'rgba(7,8,10,.42)');
    overlay.addColorStop(1, 'rgba(7,8,10,.82)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, width, height);

    const warm = ctx.createRadialGradient(width * .82, height * .40, 0, width * .82, height * .40, width * .50);
    warm.addColorStop(0, 'rgba(255,120,23,.22)');
    warm.addColorStop(1, 'rgba(255,120,23,0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, width, height);
  }

  function drawSpacedText(ctx, text, centerX, y, font, spacing, color = '#ffffff') {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    const widths = [...text].map(ch => ctx.measureText(ch).width);
    const total = widths.reduce((a,b) => a + b, 0) + spacing * Math.max(0, text.length - 1);
    let x = centerX - total / 2;
    [...text].forEach((ch, i) => {
      ctx.fillText(ch, x, y);
      x += widths[i] + spacing;
    });
  }

  function drawShareBrand(ctx) {
    const text = 'ROUTINE';
    const spacing = 18;
    ctx.font = '500 48px Arial';
    const widths = [...text].map(ch => ctx.measureText(ch).width);
    const total = widths.reduce((a,b) => a + b, 0) + spacing * (text.length - 1);
    let x = 540 - total / 2;
    [...text].forEach((ch, i) => {
      ctx.fillStyle = i === 1 ? '#ff7a1a' : '#f3f3f4';
      ctx.fillText(ch, x, 118);
      x += widths[i] + spacing;
    });
  }

  function drawShareTitle(ctx, canvasWidth) {
    const meu = 'Meu';
    const desempenho = 'desempenho';
    const gap = 24;
    ctx.font = '800 82px Arial';
    const meuWidth = ctx.measureText(meu).width;
    const desempenhoWidth = ctx.measureText(desempenho).width;
    const total = meuWidth + gap + desempenhoWidth;
    const startX = (canvasWidth - total) / 2;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#f4f4f5';
    ctx.fillText(meu, startX, 250);
    ctx.fillStyle = '#ff7a1a';
    ctx.fillText(desempenho, startX + meuWidth + gap, 250);
  }

  function fitMetricFont(ctx, text, maxWidth, startSize, minSize = 30) {
    let size = startSize;
    while (size > minSize) {
      ctx.font = `800 ${size}px Arial`;
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 2;
    }
    return size;
  }

  function drawPerformanceIcon(ctx, type, x, y, accent) {
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.fillStyle = accent;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (type === 'done') {
      ctx.beginPath();
      ctx.arc(x, y, 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 13, y);
      ctx.lineTo(x - 3, y + 11);
      ctx.lineTo(x + 17, y - 13);
      ctx.stroke();
    } else if (type === 'streak') {
      ctx.beginPath();
      ctx.moveTo(x, y + 34);
      ctx.bezierCurveTo(x - 29, y + 21, x - 31, y - 5, x - 8, y - 23);
      ctx.bezierCurveTo(x - 4, y - 12, x + 5, y - 4, x + 10, y - 22);
      ctx.bezierCurveTo(x + 34, y - 2, x + 32, y + 23, x, y + 34);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y + 24);
      ctx.bezierCurveTo(x - 10, y + 14, x - 9, y + 3, x + 1, y - 7);
      ctx.bezierCurveTo(x + 11, y + 4, x + 12, y + 15, x, y + 24);
      ctx.stroke();
    } else if (type === 'evolution') {
      const heights = [24,43,66];
      heights.forEach((h, i) => {
        ctx.fillRect(x - 28 + i * 23, y + 30 - h, 12, h);
      });
    } else if (type === 'calendar') {
      roundRectPath(ctx, x - 34, y - 29, 68, 62, 7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 34, y - 8);
      ctx.lineTo(x + 34, y - 8);
      ctx.moveTo(x - 18, y - 37);
      ctx.lineTo(x - 18, y - 22);
      ctx.moveTo(x + 18, y - 37);
      ctx.lineTo(x + 18, y - 22);
      ctx.stroke();
      [[-16,7],[0,7],[16,7],[-16,22],[0,22],[16,22]].forEach(([dx,dy]) => {
        ctx.fillRect(x + dx - 3, y + dy - 3, 6, 6);
      });
    } else if (type === 'trophy') {
      ctx.beginPath();
      ctx.moveTo(x - 24, y - 28);
      ctx.lineTo(x + 24, y - 28);
      ctx.lineTo(x + 19, y + 2);
      ctx.bezierCurveTo(x + 15, y + 22, x - 15, y + 22, x - 19, y + 2);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 24, y - 20);
      ctx.lineTo(x - 38, y - 20);
      ctx.lineTo(x - 38, y - 3);
      ctx.bezierCurveTo(x - 36, y + 10, x - 26, y + 14, x - 18, y + 14);
      ctx.moveTo(x + 24, y - 20);
      ctx.lineTo(x + 38, y - 20);
      ctx.lineTo(x + 38, y - 3);
      ctx.bezierCurveTo(x + 36, y + 10, x + 26, y + 14, x + 18, y + 14);
      ctx.moveTo(x, y + 22);
      ctx.lineTo(x, y + 39);
      ctx.moveTo(x - 17, y + 39);
      ctx.lineTo(x + 17, y + 39);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPerformanceMetricCard(ctx, card) {
    ctx.save();
    roundRectPath(ctx, card.x, card.y, card.w, card.h, 28);
    const bg = ctx.createLinearGradient(card.x, card.y, card.x, card.y + card.h);
    bg.addColorStop(0, 'rgba(24,25,27,.88)');
    bg.addColorStop(1, 'rgba(10,11,13,.92)');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = card.type === 'evolution' ? 'rgba(68,190,126,.34)' : 'rgba(255,255,255,.18)';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawPerformanceIcon(ctx, card.type, card.x + 75, card.y + 94, card.accent);

    ctx.strokeStyle = 'rgba(255,255,255,.24)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(card.x + 142, card.y + 42);
    ctx.lineTo(card.x + 142, card.y + card.h - 42);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    fitMetricFont(ctx, card.value, card.w - 190, 58, 34);
    ctx.fillText(card.value, card.x + 175, card.y + 103);

    ctx.fillStyle = '#c2c4c8';
    ctx.font = '500 25px Arial';
    card.lines.forEach((line, i) => ctx.fillText(line, card.x + 175, card.y + 150 + i * 31));
    ctx.restore();
  }

  function drawPerformanceShareLayout(ctx, stats, evolution, sequence) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    drawShareBrand(ctx);
    drawShareTitle(ctx, 1080);

    drawSpacedText(ctx, 'DISCIPLINA HOJE.', 540, 318, '500 25px Arial', 9, '#b8bbc0');
    drawSpacedText(ctx, 'UMA VIDA MELHOR AMANHÃ.', 540, 352, '500 25px Arial', 9, '#b8bbc0');

    const cx = 540, cy = 675, radius = 230;
    const adherence = Math.max(0, Math.min(100, stats.adherence));

    ctx.save();
    ctx.shadowColor = 'rgba(255,105,20,.38)';
    ctx.shadowBlur = 28;
    ctx.lineWidth = 36;
    ctx.strokeStyle = 'rgba(59,61,64,.72)';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();

    const ring = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    ring.addColorStop(0, '#ff6812');
    ring.addColorStop(.52, '#ff861d');
    ring.addColorStop(1, '#ffc35b');
    ctx.strokeStyle = ring;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (adherence / 100));
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(5,6,7,.52)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 27, 0, Math.PI * 2);
    ctx.fill();

    const adherenceText = adherence + '%';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    fitMetricFont(ctx, adherenceText, 390, 150, 108);
    ctx.fillText(adherenceText, cx, cy - 10);

    drawSpacedText(ctx, 'ADERÊNCIA', cx, cy + 82, '500 32px Arial', 10, '#e0e1e3');

    ctx.fillStyle = '#42e28e';
    [22,38,55].forEach((h, i) => {
      ctx.fillRect(cx - 29 + i * 22, cy + 157 - h, 11, h);
    });

    const cards = [
      {
        type:'done', x:62, y:995, w:458, h:205, accent:'#ff7a1a',
        value:`${stats.completedActivities} / ${stats.totalActivities}`,
        lines:['ATIVIDADES','CONCLUÍDAS']
      },
      {
        type:'streak', x:560, y:995, w:458, h:205, accent:'#ff7a1a',
        value:String(sequence),
        lines:['DIAS DE','SEQUÊNCIA']
      },
      {
        type:'evolution', x:62, y:1230, w:458, h:205, accent:evolution < 0 ? '#ff6675' : '#43e18d',
        value:signedPercent(evolution),
        lines:['DE EVOLUÇÃO']
      },
      {
        type:'calendar', x:560, y:1230, w:458, h:205, accent:'#ff7a1a',
        value:`${stats.consistentDays} / ${stats.plannedDays}`,
        lines:['DIAS','CONSISTENTES']
      }
    ];
    cards.forEach(card => drawPerformanceMetricCard(ctx, card));

    const bx = 62, by = 1472, bw = 956, bh = 235;
    roundRectPath(ctx, bx, by, bw, bh, 30);
    const callout = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    callout.addColorStop(0, 'rgba(20,18,16,.94)');
    callout.addColorStop(.70, 'rgba(18,17,17,.94)');
    callout.addColorStop(1, 'rgba(48,25,13,.94)');
    ctx.fillStyle = callout;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,122,26,.62)';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawPerformanceIcon(ctx, 'trophy', 154, 1589, '#ff7a1a');

    ctx.strokeStyle = 'rgba(255,255,255,.24)';
    ctx.beginPath();
    ctx.moveTo(230, 1518);
    ctx.lineTo(230, 1662);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 54px Arial';
    ctx.fillText('Meu melhor', 278, 1580);
    ctx.fillStyle = '#ff7a1a';
    ctx.fillText('ritmo até agora.', 278, 1640);

    ctx.strokeStyle = '#ff7a1a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(730, 1693);
    ctx.bezierCurveTo(850, 1677, 930, 1600, 1018, 1510);
    ctx.stroke();

    const month = new Intl.DateTimeFormat('pt-BR', { month:'long', year:'numeric' }).format(new Date()).toUpperCase();
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(174, 1806);
    ctx.lineTo(356, 1806);
    ctx.moveTo(724, 1806);
    ctx.lineTo(906, 1806);
    ctx.stroke();

    drawSpacedText(ctx, month, 540, 1818, '500 26px Arial', 7, '#aeb0b4');
  }

  async function performanceShareBlob(stats, evolution, sequence, backgroundImage = null) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');

    if (backgroundImage) drawImageCover(ctx, backgroundImage, canvas.width, canvas.height);
    else drawSystemShareBackground(ctx, canvas.width, canvas.height);

    drawPerformanceShareLayout(ctx, stats, evolution, sequence);

    return await new Promise(resolve =>
      canvas.toBlob(blob => resolve(blob), 'image/png', 0.97)
    );
  }

  function openPerformanceShareModal() {
    stopPerformanceCamera();
    $('#shareSourceStep').hidden = false;
    $('#shareCustomStep').hidden = true;
    $('#shareCameraStep').hidden = true;
    $('#performanceShareModal').classList.add('open');
    $('#performanceShareModal').setAttribute('aria-hidden', 'false');
  }

  function closePerformanceShareModal() {
    stopPerformanceCamera();
    $('#performanceShareModal').classList.remove('open');
    $('#performanceShareModal').setAttribute('aria-hidden', 'true');
  }

  function showShareStep(step) {
    $('#shareSourceStep').hidden = step !== 'source';
    $('#shareCustomStep').hidden = step !== 'custom';
    $('#shareCameraStep').hidden = step !== 'camera';
  }

  let performanceCameraStream = null;

  function stopPerformanceCamera() {
    performanceCameraStream?.getTracks().forEach(track => track.stop());
    performanceCameraStream = null;
    const video = $('#shareCameraVideo');
    if (video) video.srcObject = null;
  }

  async function openPerformanceCamera() {
    stopPerformanceCamera();

    if (!navigator.mediaDevices?.getUserMedia) {
      $('#shareCameraFallbackInput').click();
      return;
    }

    try {
      showShareStep('camera');
      $('#shareCameraStatus').textContent = 'Posicione a câmera e capture a foto.';
      performanceCameraStream = await navigator.mediaDevices.getUserMedia({
        video:{ facingMode:{ ideal:'environment' } },
        audio:false
      });
      $('#shareCameraVideo').srcObject = performanceCameraStream;
      await $('#shareCameraVideo').play();
    } catch {
      showShareStep('custom');
      $('#shareCameraFallbackInput').click();
    }
  }

  async function imageFromBlob(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.decoding = 'async';
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      return image;
    } finally {
      // O Image mantém os pixels carregados mesmo após a revogação da URL.
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }
  }

  async function imageFromFile(file) {
    if (!file || !String(file.type || '').startsWith('image/'))
      throw new Error('Selecione uma imagem válida.');
    return await imageFromBlob(file);
  }

  async function capturePerformancePhoto() {
    const video = $('#shareCameraVideo');
    if (!video.videoWidth || !video.videoHeight) {
      toast('A câmera ainda está iniciando');
      return;
    }

    const capture = document.createElement('canvas');
    capture.width = video.videoWidth;
    capture.height = video.videoHeight;
    capture.getContext('2d').drawImage(video, 0, 0, capture.width, capture.height);

    const blob = await new Promise(resolve => capture.toBlob(resolve, 'image/jpeg', 0.94));
    stopPerformanceCamera();
    closePerformanceShareModal();

    if (!blob) {
      toast('Não foi possível capturar a foto');
      return;
    }

    try {
      const image = await imageFromBlob(blob);
      await generateAndSharePerformance(image);
    } catch {
      toast('Não foi possível usar a fotografia');
    }
  }

  async function generateAndSharePerformance(backgroundImage = null) {
    const ref = new Date();
    const current = performancePeriodStats(ref, 30, 0);
    const previous = performancePeriodStats(ref, 30, 30);
    const evolution = current.adherence - previous.adherence;
    const sequence = streak(ref);

    toast('Preparando seu card...');
    const blob = await performanceShareBlob(current, evolution, sequence, backgroundImage);
    if (!blob) return;

    const filename = `routine-desempenho-${key(ref)}.png`;
    const file = new File([blob], filename, { type:'image/png' });

    try {
      if (navigator.canShare?.({ files:[file] })) {
        await navigator.share({
          title:'Meu desempenho no ROUTINE',
          text:`${current.adherence}% de aderência · ${current.completedActivities}/${current.totalActivities} atividades concluídas · ${sequence} dias de sequência`,
          files:[file]
        });
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Card de desempenho gerado');
  }

  async function usePerformanceImageFile(file) {
    if (!file) return;
    try {
      const image = await imageFromFile(file);
      closePerformanceShareModal();
      await generateAndSharePerformance(image);
    } catch (err) {
      toast(err.message || 'Não foi possível usar a imagem');
    } finally {
      $('#shareGalleryInput').value = '';
      $('#shareCameraFallbackInput').value = '';
    }
  }

  function sharePerformanceResults() {
    openPerformanceShareModal();
  }

  function renderHistory() {
    const rows = [];

    executions.filter(e => e.status !== 'pending').forEach(e => {
      const a = allActivities.find(x => x.id === e.activityId);
      rows.push({
        date:e.date,
        time:a?.time || e.activityTime || '—',
        title:a?.title || e.activityTitle || 'Atividade removida',
        context:a?.category || e.activityCategory || 'Rotina',
        status:e.status,
        updated:e.updatedAt || e.date
      });
    });

    todoTasks.filter(t => ['done','skipped'].includes(t.status)).forEach(t => {
      const date = t.status === 'done'
        ? (completionDateKey(t) || t.dueDate || String(t.updatedAt || '').slice(0,10) || todayKey())
        : (t.dueDate || String(t.updatedAt || '').slice(0,10) || todayKey());
      rows.push({
        date,
        time:t.dueTime || '—',
        title:`Tarefa: ${t.title}`,
        context:taskActivityName(t) || t.project || 'To Do',
        status:t.status,
        updated:t.updatedAt || date
      });
    });

    rows.sort((a,b) => String(b.updated).localeCompare(String(a.updated)));

    $('#historyBody').innerHTML = rows.length ? rows.slice(0,150).map(r =>
      `<tr><td>${fromKey(r.date).toLocaleDateString('pt-BR')}</td><td>${esc(r.time)}</td><td>${esc(r.title)}</td><td>${esc(r.context)}</td><td class="status ${r.status}">${statusLabel(r.status)}</td></tr>`
    ).join('') : '<tr><td colspan="5">Nenhum histórico registrado.</td></tr>';
  }

  function taskMatchesCommon(t) {
    if (todoActivity && t.activityId !== todoActivity) return false;
    if (todoStatus === 'open' && !['pending','progress'].includes(t.status)) return false;
    if (todoStatus !== 'all' && todoStatus !== 'open' && t.status !== todoStatus) return false;

    if (todoSearch) {
      const hay = `${t.title} ${t.project || ''} ${taskActivityName(t)}`.toLowerCase();
      if (!hay.includes(todoSearch.toLowerCase())) return false;
    }
    return true;
  }

  function scopedTasks() {
    const today = todayKey();
    const weekEnd = key(addDays(new Date(), 6));

    return todoTasks.filter(t => {
      if (!taskMatchesCommon(t)) return false;
      if (todoScope === 'today') return t.dueDate === today;
      if (todoScope === 'week') return !!t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd;
      if (todoScope === 'done') return t.status === 'done';
      return true;
    }).sort(taskSort);
  }

  function taskSort(a,b) {
    const statusOrder = x => x.status === 'done' ? 2 : x.status === 'skipped' ? 3 : x.status === 'progress' ? 0 : 1;
    return statusOrder(a) - statusOrder(b) ||
      String(a.dueDate || '9999-12-31').localeCompare(String(b.dueDate || '9999-12-31')) ||
      String(a.dueTime || '99:99').localeCompare(String(b.dueTime || '99:99')) ||
      String(a.createdAt).localeCompare(String(b.createdAt));
  }

  function overdueTasks() {
    const today = todayKey();
    return todoTasks.filter(t =>
      ['pending','progress'].includes(t.status) &&
      !!t.dueDate &&
      t.dueDate < today &&
      (!todoActivity || t.activityId === todoActivity) &&
      (!todoSearch || `${t.title} ${t.project || ''} ${taskActivityName(t)}`.toLowerCase().includes(todoSearch.toLowerCase()))
    ).sort(taskSort);
  }

  function renderTodoContext() {
    const box = $('#todoContext');
    const activity = todoActivity ? allActivities.find(a => a.id === todoActivity) : null;

    if (!activity) {
      box.hidden = true;
      return;
    }

    const archived = !!activity.archivedAt;
    box.hidden = false;
    $('#todoContextTitle').textContent = activity.title;
    $('#todoContextMeta').textContent = `${activity.time} → ${endTimeFor(activity)} · ${activity.category} · ${activity.type === 'habit' ? 'Hábito' : 'Rotina'}${archived ? ' · Arquivada' : ''}`;
    $('#todoContextNewTask').hidden = archived;

    const selectedDateKey = key(selected);
    const relatedForSelectedDay = todoTasks.filter(t => t.activityId === activity.id && t.dueDate === selectedDateKey);
    const relevant = relatedForSelectedDay.length
      ? relatedForSelectedDay
      : todoTasks.filter(t => t.activityId === activity.id && ['pending','progress'].includes(t.status));

    const total = relevant.length;
    const done = relatedForSelectedDay.length
      ? relevant.filter(t => taskDoneForDate(t, selected)).length
      : relevant.filter(t => t.status === 'done').length;
    const pct = total ? Math.round(done / total * 100) : 0;

    $('#todoContextProgressText').textContent = total
      ? `${done} de ${total} tarefas concluídas`
      : 'Nenhuma tarefa cadastrada para esta rotina';
    $('#todoContextProgressPct').textContent = pct + '%';
    $('#todoContextProgressBar').style.width = pct + '%';
  }

  function renderTodo() {
    const today = todayKey();
    renderTodoContext();
    const todayTasks = todoTasks.filter(t => t.dueDate === today);
    const pending = todoTasks.filter(t => ['pending','progress'].includes(t.status));
    const doneToday = todoTasks.filter(t => t.status === 'done' && (completionDateKey(t) || t.dueDate) === today);
    const overdue = todoTasks.filter(t => ['pending','progress'].includes(t.status) && t.dueDate && t.dueDate < today);

    $('#todoTodayCount').textContent = todayTasks.length;
    $('#todoPendingCount').textContent = pending.length;
    $('#todoDoneCount').textContent = doneToday.length;
    $('#todoOverdueCount').textContent = overdue.length;

    const routineFilter = $('#todoRoutineFilter');
    const activeOptions = [...activities]
      .sort((a,b) => a.title.localeCompare(b.title))
      .map(a => `<option value="${a.id}">${esc(a.title)}</option>`)
      .join('');
    const selectedArchived = todoActivity && !activities.some(a => a.id === todoActivity)
      ? allActivities.find(a => a.id === todoActivity)
      : null;
    const archivedOption = selectedArchived
      ? `<option value="${selectedArchived.id}">${esc(selectedArchived.title)} (arquivada)</option>`
      : '';

    routineFilter.innerHTML = '<option value="">Todas as rotinas</option>' + activeOptions + archivedOption;
    routineFilter.value = todoActivity;
    $('#todoStatusFilter').value = todoStatus;
    $('#todoSearch').value = todoSearch;

    $$('[data-todo-scope]').forEach(b => b.classList.toggle('active', b.dataset.todoScope === todoScope));

    const list = scopedTasks();
    $('#todoResultCount').textContent = list.length;
    $('#todoList').innerHTML = list.length ? list.map(taskRowHtml).join('') : '<div class="empty">Nenhuma tarefa encontrada neste filtro.</div>';

    const late = overdueTasks();
    const showOverdue = todoScope === 'today' && ['open','all','progress','pending'].includes(todoStatus);
    $('#overdueSection').style.display = showOverdue && late.length ? '' : 'none';
    $('#overdueLabel').textContent = late.length ? `${late.length} em atraso` : '';
    $('#overdueList').innerHTML = late.map(taskRowHtml).join('');

    bindTaskRows();
  }

  function taskRowHtml(t) {
    const activity = taskActivityName(t);
    const context = activity || t.project || 'Sem rotina';
    const due = t.dueDate
      ? `${fromKey(t.dueDate).toLocaleDateString('pt-BR')}${t.dueTime ? `, ${t.dueTime}` : ''}`
      : 'Sem prazo';
    const checklist = t.checklist || [];
    const checkDone = checklist.filter(x => x.done).length;

    return `<div class="todo-row ${t.status}" data-task-row="${t.id}">
      <button class="todo-check ${t.status === 'done' ? 'checked' : ''}" data-task-toggle="${t.id}" aria-label="Alternar conclusão">${t.status === 'done' ? '✓' : ''}</button>
      <div class="todo-task-main"><strong>${esc(t.title)}</strong><span>${esc(context)}${checklist.length ? ` · checklist ${checkDone}/${checklist.length}` : ''}</span></div>
      <div class="todo-due ${t.dueDate && t.dueDate < todayKey() && !['done','skipped'].includes(t.status) ? 'late' : ''}">${due}</div>
      <span class="task-status ${t.status}">${statusLabel(t.status)}</span>
      <button class="todo-open" data-task-open="${t.id}" aria-label="Abrir detalhes">›</button>
    </div>`;
  }

  function bindTaskRows() {
    $$('[data-task-toggle]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const task = todoTasks.find(t => t.id === b.dataset.taskToggle);
      if (!task) return;
      await setTaskStatus(task.id, task.status === 'done' ? 'pending' : 'done');
    });
    $$('[data-task-open]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      openTaskDrawer(b.dataset.taskOpen);
    });
    $$('[data-task-row]').forEach(row => row.onclick = () => openTaskDrawer(row.dataset.taskRow));
  }

  function renderTaskDrawer() {
    const task = todoTasks.find(t => t.id === activeTaskId);
    if (!task) {
      $('#taskDrawer').classList.remove('open');
      $('#taskDrawerBackdrop').classList.remove('open');
      $('#taskDrawer').setAttribute('aria-hidden','true');
      return;
    }

    const activity = activityName(task.activityId) || 'Sem rotina vinculada';
    const due = task.dueDate ? fromKey(task.dueDate).toLocaleDateString('pt-BR') + (task.dueTime ? `, ${task.dueTime}` : '') : 'Sem prazo';
    const checklist = task.checklist || [];
    const done = checklist.filter(x => x.done).length;

    $('#drawerTitle').textContent = task.title;
    $('#drawerBody').innerHTML = `
      <div class="drawer-meta-grid">
        <div><span>Rotina</span><strong>${esc(activity)}</strong></div>
        <div><span>Projeto / contexto</span><strong>${esc(task.project || '—')}</strong></div>
        <div><span>Prazo</span><strong>${esc(due)}</strong></div>
        <div><span>Prioridade</span><strong>${priorityLabel(task.priority)}</strong></div>
      </div>

      <div class="drawer-status-line"><span class="task-status ${task.status}">${statusLabel(task.status)}</span></div>

      ${task.notes ? `<div class="drawer-notes"><span>Observação</span><p>${esc(task.notes)}</p></div>` : ''}

      <div class="drawer-actions">
        <button class="btn" data-drawer-status="progress">Iniciar</button>
        <button class="btn good-btn" data-drawer-status="done">Concluir tarefa</button>
        <button class="btn danger-btn" data-drawer-status="skipped">Não realizada</button>
      </div>

      <div class="checklist-block">
        <div class="section-title"><strong>Checklist</strong><span>${done} de ${checklist.length}</span></div>
        <div id="drawerChecklist">
          ${checklist.length ? checklist.map((item, i) => `<div class="checklist-item">
            <button class="checklist-toggle ${item.done ? 'done' : ''}" data-check-toggle="${item.id}">${item.done ? '✓' : ''}</button>
            <span class="${item.done ? 'done-text' : ''}">${esc(item.title)}</span>
            <button class="checklist-delete" data-check-delete="${item.id}">×</button>
          </div>`).join('') : '<div class="empty small-empty">Sem itens no checklist.</div>'}
        </div>
        <form id="checklistForm" class="checklist-add">
          <input id="checklistText" maxlength="200" placeholder="Adicionar item ao checklist">
          <button class="btn">Adicionar</button>
        </form>
      </div>

      <div class="drawer-footer">
        <button class="btn" id="editDrawerTask">Editar</button>
        <button class="btn danger-btn" id="deleteDrawerTask">Excluir tarefa</button>
      </div>
    `;

    $$('[data-drawer-status]').forEach(b => b.onclick = () => setTaskStatus(task.id, b.dataset.drawerStatus));
    $$('[data-check-toggle]').forEach(b => b.onclick = async () => {
      const item = checklist.find(x => x.id === b.dataset.checkToggle);
      if (!item) return;
      const updated = await api(`/api/tasks/${task.id}/checklist/${item.id}`, {
        method:'PUT',
        body:JSON.stringify({ title:item.title, done:!item.done, sortOrder:item.sortOrder || 0 })
      });
      replaceChecklistItem(task.id, updated);
    });
    $$('[data-check-delete]').forEach(b => b.onclick = async () => {
      await api(`/api/tasks/${task.id}/checklist/${b.dataset.checkDelete}`, { method:'DELETE' });
      const current = todoTasks.find(t => t.id === task.id);
      current.checklist = (current.checklist || []).filter(x => x.id !== b.dataset.checkDelete);
      renderTaskDrawer();
      renderTodo();
    });

    $('#checklistForm').onsubmit = async e => {
      e.preventDefault();
      const input = $('#checklistText');
      const title = input.value.trim();
      if (!title) return;
      const added = await api(`/api/tasks/${task.id}/checklist`, {
        method:'POST',
        body:JSON.stringify({ title, done:false, sortOrder:checklist.length })
      });
      const current = todoTasks.find(t => t.id === task.id);
      current.checklist = [...(current.checklist || []), added];
      input.value = '';
      renderTaskDrawer();
      renderTodo();
    };

    $('#editDrawerTask').onclick = () => {
      const id = task.id;
      closeTaskDrawer();
      openTaskModal(id);
    };
    $('#deleteDrawerTask').onclick = async () => {
      if (!confirm('Excluir esta tarefa?')) return;
      await api('/api/tasks/' + task.id, { method:'DELETE' });
      todoTasks = todoTasks.filter(t => t.id !== task.id);
      activeTaskId = null;
      renderAll();
      toast('Tarefa excluída');
    };
  }

  function replaceChecklistItem(taskId, updated) {
    const task = todoTasks.find(t => t.id === taskId);
    if (!task) return;
    task.checklist = (task.checklist || []).map(x => x.id === updated.id ? updated : x);
    renderTaskDrawer();
    renderTodo();
    renderToday();
  }

  function openTaskDrawer(id) {
    activeTaskId = id;
    $('#taskDrawer').classList.add('open');
    $('#taskDrawerBackdrop').classList.add('open');
    $('#taskDrawer').setAttribute('aria-hidden','false');
    renderTaskDrawer();
  }

  function closeTaskDrawer() {
    activeTaskId = null;
    renderTaskDrawer();
  }

  async function setTaskStatus(id, status) {
    const existing = todoTasks.find(t => t.id === id);
    const updated = await api(`/api/tasks/${id}/status`, {
      method:'PUT',
      body:JSON.stringify({ status })
    });
    const merged = {
      ...existing,
      ...updated,
      activityTitle: updated.activityTitle || existing?.activityTitle || ''
    };
    todoTasks = todoTasks.map(t => t.id === id ? merged : t);
    renderAll();
    if (activeTaskId === id) renderTaskDrawer();
    toast(statusLabel(status));
  }

  function renderTaskSelects(task = null) {
    const activeOptions = [...activities]
      .filter(a => a.active)
      .sort((a,b) => a.title.localeCompare(b.title))
      .map(a => `<option value="${a.id}">${esc(a.title)}</option>`)
      .join('');

    const linkedArchived = task?.activityId && !activities.some(a => a.id === task.activityId)
      ? allActivities.find(a => a.id === task.activityId)
      : null;

    const archivedOption = linkedArchived
      ? `<option value="${linkedArchived.id}">${esc(linkedArchived.title)} (arquivada)</option>`
      : '';

    $('#taskActivity').innerHTML =
      '<option value="">Sem rotina vinculada</option>' +
      activeOptions +
      archivedOption;
  }

  function openTaskModal(id = '', presetActivityId = '') {
    const task = id ? todoTasks.find(t => t.id === id) : null;
    if (id && !task) return;

    const form = $('#taskForm');
    form.reset();
    renderTaskSelects(task);

    $('#taskId').value = '';
    $('#taskRequestId').value = uuid();
    $('#taskPriority').value = 'medium';
    $('#taskDueDate').value = key(selected);
    $('#taskActivity').value = presetActivityId || '';
    $('#taskModalTitle').textContent = id ? 'Editar tarefa' : 'Nova tarefa';

    if (id) {
      $('#taskId').value = task.id;
      $('#taskRequestId').value = task.clientRequestId || uuid();
      $('#taskTitle').value = task.title;
      $('#taskActivity').value = task.activityId || '';
      $('#taskProject').value = task.project || '';
      $('#taskDueDate').value = task.dueDate || '';
      $('#taskDueTime').value = task.dueTime || '';
      $('#taskPriority').value = task.priority || 'medium';
      $('#taskNotes').value = task.notes || '';
    }

    $('#taskModal').classList.add('open');
  }

  function closeTaskModal() {
    $('#taskModal').classList.remove('open');
  }

  async function saveTask(payload, id = '') {
    const previous = id ? todoTasks.find(t => t.id === id) : null;
    const saved = id
      ? await api('/api/tasks/' + id, { method:'PUT', body:JSON.stringify(payload) })
      : await api('/api/tasks', { method:'POST', body:JSON.stringify(payload) });

    const merged = {
      ...previous,
      ...saved,
      activityTitle:
        saved.activityTitle ||
        activityName(saved.activityId) ||
        (saved.activityId === previous?.activityId ? previous?.activityTitle || '' : '')
    };

    todoTasks = todoTasks.filter(t => t.id !== merged.id);
    todoTasks.push(merged);
    return merged;
  }

  function openActivityModal(id = '') {
    const form = $('#activityForm');
    form.reset();
    $('#activityId').value = '';
    $('#activityRequestId').value = uuid();
    $('#activityTime').value = '09:00';
    $('#activityEndTime').value = '09:30';
    $('#activityPriority').value = 'medium';
    $('#activityType').value = 'routine';
    $('#activityActive').checked = true;
    $('#activityNoEnd').checked = true;
    $('#activityEnd').value = '';
    syncEndDate();
    document.querySelectorAll('#daysPicker input').forEach(c => c.checked = [1,2,3,4,5].includes(+c.value));
    $('#modalTitle').textContent = id ? 'Editar atividade' : 'Nova atividade';

    if (id) {
      const a = activities.find(x => x.id === id);
      if (!a) return;
      $('#activityId').value = a.id;
      $('#activityRequestId').value = a.clientRequestId || '';
      $('#activityTitle').value = a.title;
      $('#activityCategory').value = a.category;
      $('#activityTime').value = a.time;
      $('#activityEndTime').value = endTimeFor(a);
      $('#activityPriority').value = a.priority;
      $('#activityType').value = a.type;
      $('#activityStart').value = a.startDate || '';
      $('#activityNoEnd').checked = !a.endDate;
      $('#activityEnd').value = a.endDate || '';
      syncEndDate();
      $('#activityNotes').value = a.notes || '';
      $('#activityActive').checked = a.active;
      document.querySelectorAll('#daysPicker input').forEach(c => c.checked = days(a).includes(+c.value));
    }

    updateDurationPreview();
    $('#activityModal').classList.add('open');
  }

  function closeActivityModal() {
    $('#activityModal').classList.remove('open');
  }

  async function saveActivity(activity) {
    const body = {
      ...activity,
      weight:1,
      user:null,
      executions:[],
      days:Array.isArray(activity.days) ? activity.days.join(',') : activity.days
    };
    const saved = activity.id
      ? await api('/api/activities/' + activity.id, { method:'PUT', body:JSON.stringify(body) })
      : await api('/api/activities', { method:'POST', body:JSON.stringify(body) });

    activities = activities.filter(x => x.id !== saved.id);
    activities.push(saved);
    allActivities = allActivities.filter(x => x.id !== saved.id);
    allActivities.push(saved);
    renderAll();
    return saved;
  }

  async function setExecution(activityId, status) {
    const date = key(selected);
    const result = await api(`/api/executions/${activityId}/${date}`, {
      method:'PUT',
      body:JSON.stringify({ status })
    });

    executions = executions.filter(e => !(e.activityId === activityId && e.date === date));
    if (status !== 'pending') executions.push(result);
    renderAll();
    toast(status === 'done' ? 'Atividade concluída' : status === 'progress' ? 'Atividade iniciada' : 'Atividade marcada como não realizada');
  }

  function openTasksForActivity(activityId) {
    todoActivity = activityId;
    todoScope = key(selected) === todayKey() ? 'today' : 'all';
    todoStatus = 'open';
    todoSearch = '';
    setView('todo');
  }

  function setView(view) {
    activeView = view;
    $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === view + 'View'));

    const meta = {
      today:['VISÃO DIÁRIA','Sua rotina de hoje','Veja o que precisa acontecer agora e avance passo a passo.'],
      routine:['ESTRUTURA','Minha rotina','Organize seus blocos de rotina e as tarefas ligadas a cada um.'],
      todo:['EXECUÇÃO','To Do','Todas as tarefas da sua rotina em um único lugar.'],
      habits:['CONSISTÊNCIA','Hábitos','Veja o que está se tornando constante.'],
      performance:['INDICADORES','Desempenho','Seu progresso, em uma visão simples e clara.'],
      history:['RASTREABILIDADE','Histórico','Veja o que foi concluído, iniciado ou não realizado.']
    }[view];

    $('#pageEyebrow').textContent = meta[0];
    $('#pageTitle').textContent = meta[1];
    $('#pageSubtitle').textContent = meta[2];

    const action = $('#headerAction');
    action.hidden = view === 'performance';

    if (view === 'todo') {
      action.hidden = false;
      action.textContent = '+ Nova tarefa';
      action.onclick = () => openTaskModal('', todoActivity);
    } else if (view !== 'performance') {
      action.hidden = false;
      action.textContent = '+ Nova atividade';
      action.onclick = () => openActivityModal();
    }

    if (view === 'routine') renderRoutine();
    if (view === 'todo') renderTodo();
    if (view === 'performance') renderPerformance();
  }

  function renderAll() {
    renderToday();
    renderRoutine();
    renderTodo();
    renderHabits();
    renderPerformance();
    renderHistory();
  }

  $('#activityForm').onsubmit = async e => {
    e.preventDefault();
    const button = $('#saveActivityBtn');
    if (button.disabled) return;

    const selectedDays = Array.from(document.querySelectorAll('#daysPicker input:checked')).map(x => +x.value);
    if (!selectedDays.length) return alert('Selecione pelo menos um dia.');

    const durationMinutes = durationFromRange();
    if (durationMinutes < 5) return alert('O horário final precisa ser diferente do horário inicial.');

    const startDate = $('#activityStart').value || null;
    const endDate = $('#activityNoEnd').checked ? null : ($('#activityEnd').value || null);
    if (endDate && startDate && endDate < startDate) return alert('A data final não pode ser anterior à data de início.');

    const old = activities.find(x => x.id === $('#activityId').value);

    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'Salvando...';

    try {
      await saveActivity({
        ...old,
        id:$('#activityId').value || undefined,
        title:$('#activityTitle').value.trim(),
        category:$('#activityCategory').value.trim(),
        time:$('#activityTime').value,
        durationMinutes,
        priority:$('#activityPriority').value,
        type:$('#activityType').value,
        days:selectedDays.join(','),
        startDate,
        endDate,
        notes:$('#activityNotes').value.trim() || null,
        clientRequestId:old?.clientRequestId || $('#activityRequestId').value || null,
        active:$('#activityActive').checked
      });
      closeActivityModal();
      toast(old ? 'Atividade atualizada' : 'Atividade criada');
    } catch (err) {
      alert(err.message);
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  };

  $('#taskForm').onsubmit = async e => {
    e.preventDefault();
    const button = $('#saveTaskBtn');
    if (button.disabled) return;

    const id = $('#taskId').value;
    const old = todoTasks.find(t => t.id === id);

    const payload = {
      title:$('#taskTitle').value.trim(),
      activityId:$('#taskActivity').value || null,
      project:$('#taskProject').value.trim() || null,
      dueDate:$('#taskDueDate').value || null,
      dueTime:$('#taskDueTime').value || null,
      status:old?.status || 'pending',
      priority:$('#taskPriority').value,
      notes:$('#taskNotes').value.trim() || null,
      clientRequestId:id ? old?.clientRequestId || null : $('#taskRequestId').value
    };

    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'Salvando...';

    try {
      const saved = await saveTask(payload, id);
      closeTaskModal();
      activeTaskId = saved.id;
      renderAll();
      if (id) openTaskDrawer(saved.id);
      toast(id ? 'Tarefa atualizada' : 'Tarefa criada');
    } catch (err) {
      alert(err.message);
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  };

  $('#activityTime').addEventListener('input', updateDurationPreview);
  $('#activityEndTime').addEventListener('input', updateDurationPreview);
  $('#activityNoEnd').addEventListener('change', syncEndDate);
  $('#closeActivityModal').onclick = closeActivityModal;
  $('#cancelActivityModal').onclick = closeActivityModal;
  $('#closeTaskModal').onclick = closeTaskModal;
  $('#cancelTaskModal').onclick = closeTaskModal;
  $('#newTask').onclick = () => openTaskModal('', todoActivity);
  $('#todoContextNewTask').onclick = () => openTaskModal('', todoActivity);
  $('#todoContextClear').onclick = () => {
    todoActivity = '';
    todoScope = 'today';
    todoStatus = 'open';
    renderTodo();
  };

  $$('[data-routine-mode]').forEach(button => {
    button.onclick = () => {
      routineMode = button.dataset.routineMode;
      localStorage.setItem('routine_structure_mode', routineMode);
      routineCalendarAutoScrollKey = '';
      renderRoutine();
    };
  });

  $('#routinePrevDay').onclick = () => {
    routineDate = addDays(routineDate, -1);
    routineCalendarAutoScrollKey = '';
    renderRoutine();
  };

  $('#routineNextDay').onclick = () => {
    routineDate = addDays(routineDate, 1);
    routineCalendarAutoScrollKey = '';
    renderRoutine();
  };

  $('#routineToday').onclick = () => {
    routineDate = new Date();
    routineDate.setHours(12, 0, 0, 0);
    routineCalendarAutoScrollKey = '';
    renderRoutine();
  };

  setInterval(() => {
    if (activeView === 'routine' && routineMode === 'calendar') updateRoutineCurrentTimeLine();
  }, 30000);

  $('#sharePerformance').onclick = sharePerformanceResults;
  $('#closePerformanceShareModal').onclick = closePerformanceShareModal;
  $('#performanceShareModal').addEventListener('click', e => {
    if (e.target === $('#performanceShareModal')) closePerformanceShareModal();
  });
  $('#shareSystemBackground').onclick = async () => {
    closePerformanceShareModal();
    await generateAndSharePerformance();
  };
  $('#shareCustomBackground').onclick = () => showShareStep('custom');
  $('#shareCustomBack').onclick = () => showShareStep('source');
  $('#shareOpenGallery').onclick = () => $('#shareGalleryInput').click();
  $('#shareOpenCamera').onclick = openPerformanceCamera;
  $('#shareCameraBack').onclick = () => {
    stopPerformanceCamera();
    showShareStep('custom');
  };
  $('#shareCapturePhoto').onclick = capturePerformancePhoto;
  $('#shareGalleryInput').addEventListener('change', e => usePerformanceImageFile(e.target.files?.[0]));
  $('#shareCameraFallbackInput').addEventListener('change', e => usePerformanceImageFile(e.target.files?.[0]));

  $('#prevDay').onclick = () => { selected = addDays(selected, -1); renderToday(); };
  $('#nextDay').onclick = () => { selected = addDays(selected, 1); renderToday(); };

  $('#todoSearch').addEventListener('input', e => { todoSearch = e.target.value.trim(); renderTodo(); });
  $('#todoRoutineFilter').addEventListener('change', e => { todoActivity = e.target.value; renderTodo(); });
  $('#todoStatusFilter').addEventListener('change', e => { todoStatus = e.target.value; renderTodo(); });
  $$('[data-todo-scope]').forEach(b => b.onclick = () => {
    todoScope = b.dataset.todoScope;
    if (todoScope === 'done') todoStatus = 'all';
    else if (todoStatus === 'done') todoStatus = 'open';
    renderTodo();
  });

  $('#closeTaskDrawer').onclick = closeTaskDrawer;
  $('#taskDrawerBackdrop').onclick = closeTaskDrawer;

  $('#logoutBtn').onclick = () => {
    localStorage.clear();
    location.replace('/login.html');
  };

  $$('nav button').forEach(b => b.onclick = () => setView(b.dataset.view));

  (async () => {
    try {
      const me = await api('/api/auth/me');
      $('#currentUser').textContent = me.login || 'Usuário';

      const ref = new Date();
      [activities, allActivities, executions, todoTasks] = await Promise.all([
        api('/api/activities'),
        api('/api/activities?includeArchived=true'),
        api(`/api/executions?from=${key(addDays(ref,-220))}&to=${key(addDays(ref,60))}`),
        api('/api/tasks')
      ]);

      todoTasks.forEach(t => t.checklist ||= []);
      renderAll();
      setView('today');
    } catch (err) {
      console.error(err);
      if (!String(err.message).includes('Sessão')) {
        alert('Não foi possível carregar o ROUTINE 2.0: ' + err.message);
      }
    }
  })();
})();