(() => {
  const token = localStorage.getItem('routine_token');
  if (!token) { location.replace('/login.html'); return; }

  let activities = [];
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
    return a.active &&
      (!a.startDate || k >= a.startDate) &&
      (!a.endDate || k <= a.endDate) &&
      days(a).includes(d.getDay());
  }

  function dayActivities(d) {
    return activities.filter(a => planned(a, d)).sort((a,b) => a.time.localeCompare(b.time));
  }

  function executionStatus(d, activityId) {
    return executions.find(e => e.date === key(d) && e.activityId === activityId)?.status || 'pending';
  }

  function linkedTasks(activityId, d) {
    const k = key(d);
    return todoTasks.filter(t => t.activityId === activityId && t.dueDate === k);
  }

  function activityProgress(a, d) {
    const linked = linkedTasks(a.id, d);
    if (linked.length) {
      const done = linked.filter(t => t.status === 'done').length;
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

  function statusLabel(status) {
    return ({pending:'A fazer', progress:'Em andamento', done:'Concluída', skipped:'Não realizada'})[status] || status;
  }

  function priorityLabel(priority) {
    return ({low:'Baixa', medium:'Média', high:'Alta'})[priority] || 'Média';
  }

  function activityName(id) {
    return activities.find(a => a.id === id)?.title || '';
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
    const action = linked.length
      ? `<button class="focus-action" data-focus-tasks="${activity.id}">Abrir ${linked.length} tarefa${linked.length === 1 ? '' : 's'}</button>`
      : progress === 100
        ? '<span class="focus-done">Concluída</span>'
        : `<button class="focus-action" data-focus-done="${activity.id}">Concluir atividade</button>`;

    return `<span class="focus-label">${label}</span>
      <div class="focus-title"><strong>${esc(activity.title)}</strong><span>${activity.time} → ${endTimeFor(activity)}</span></div>
      <p>${esc(activity.category)}${linked.length ? ` · ${linked.filter(t => t.status === 'done').length}/${linked.length} tarefas concluídas` : ''}</p>
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
      const done = linked.filter(t => t.status === 'done').length;
      const progress = activityProgress(a, selected);
      const st = executionStatus(selected, a.id);

      const actions = linked.length
        ? `<button class="btn activity-task-btn" data-open-tasks="${a.id}">Abrir tarefas <span>${done}/${linked.length}</span></button>`
        : `<div class="activity-actions">
            <button class="mini orange" data-activity-status="progress" data-activity-id="${a.id}">Iniciar</button>
            <button class="mini good" data-activity-status="done" data-activity-id="${a.id}">Concluir</button>
            <button class="mini red" data-activity-status="skipped" data-activity-id="${a.id}">Não realizada</button>
          </div>`;

      return `<div class="day-activity ${st}">
        <div class="activity-time"><strong>${a.time}</strong><span>${endTimeFor(a)}</span></div>
        <div class="activity-main">
          <div class="activity-heading"><div><strong>${esc(a.title)}</strong><p>${esc(a.category)} · ${a.type === 'habit' ? 'Hábito' : 'Rotina'}</p></div><b>${progress}%</b></div>
          <div class="activity-progress"><i style="width:${progress}%"></i></div>
          <div class="activity-meta">${linked.length ? `${done} de ${linked.length} tarefas concluídas` : `Conclusão manual · ${dur(a.durationMinutes)}`}</div>
        </div>
        <div class="activity-card-actions">${actions}</div>
      </div>`;
    }).join('') : '<div class="empty">Nenhuma atividade planejada para este dia.</div>';

    $$('[data-open-tasks]').forEach(b => b.onclick = () => openTasksForActivity(b.dataset.openTasks));
    $$('[data-activity-status]').forEach(b => b.onclick = () => setExecution(b.dataset.activityId, b.dataset.activityStatus));

    renderBars('#weeklyChart', 7, selected);
    $('#weekAverage').textContent = avg(7, selected) + '% média';
    renderCategories();
  }

  function renderRoutine() {
    const names = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    $('#routineList').innerHTML = activities.length
      ? [...activities].sort((a,b) => a.time.localeCompare(b.time)).map(a => {
          const openTasks = todoTasks.filter(t => t.activityId === a.id && !['done','skipped'].includes(t.status)).length;
          return `<div class="routinecard ${a.active ? '' : 'paused'}">
            <div class="routinetop">
              <div><strong>${esc(a.title)}</strong><p>${esc(a.category)} · ${a.type === 'habit' ? 'Hábito' : 'Rotina'}</p></div>
              <strong>${a.time} → ${endTimeFor(a)}</strong>
            </div>
            <p>${days(a).map(x => names[x]).join(', ')} · ${dur(a.durationMinutes)}${a.endDate ? ` · até ${fromKey(a.endDate).toLocaleDateString('pt-BR')}` : ' · sem data final'}</p>
            <div class="routine-task-summary"><span>${openTasks} tarefa${openTasks === 1 ? '' : 's'} pendente${openTasks === 1 ? '' : 's'}</span><button class="mini orange" data-routine-tasks="${a.id}">Ver tarefas</button></div>
            <div class="routines">
              <button class="mini" data-edit-activity="${a.id}">Editar</button>
              <button class="mini orange" data-toggle-activity="${a.id}">${a.active ? 'Pausar' : 'Ativar'}</button>
              <button class="mini red" data-delete-activity="${a.id}">Excluir</button>
            </div>
          </div>`;
        }).join('')
      : '<div class="empty">Sua rotina está vazia.</div>';

    $$('[data-edit-activity]').forEach(b => b.onclick = () => openActivityModal(b.dataset.editActivity));
    $$('[data-routine-tasks]').forEach(b => b.onclick = () => openTasksForActivity(b.dataset.routineTasks));
    $$('[data-toggle-activity]').forEach(b => b.onclick = async () => {
      const a = activities.find(x => x.id === b.dataset.toggleActivity);
      if (!a) return;
      await saveActivity({...a, active: !a.active});
      toast('Atividade atualizada');
    });
    $$('[data-delete-activity]').forEach(b => b.onclick = async () => {
      const id = b.dataset.deleteActivity;
      if (!confirm('Excluir esta rotina? As tarefas vinculadas serão mantidas no To Do sem vínculo.')) return;
      await api('/api/activities/' + id, { method:'DELETE' });
      activities = activities.filter(x => x.id !== id);
      todoTasks.forEach(t => { if (t.activityId === id) t.activityId = null; });
      renderAll();
      toast('Atividade excluída');
    });
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

  function renderPerformance() {
    const ref = new Date();
    $('#avg7').textContent = avg(7, ref) + '%';
    $('#avg30').textContent = avg(30, ref) + '%';
    $('#bestStreak').textContent = bestStreak();

    let total = 0, completed = 0;
    for (let i = 29; i >= 0; i--) {
      const d = addDays(ref, -i);
      dayActivities(d).forEach(a => {
        total++;
        if (activityProgress(a, d) === 100) completed++;
      });
    }
    $('#completion30').textContent = (total ? Math.round(completed / total * 100) : 0) + '%';
    renderBars('#performanceChart', 14, ref, true);
  }

  function renderHistory() {
    const rows = [];

    executions.filter(e => e.status !== 'pending').forEach(e => {
      const a = activities.find(x => x.id === e.activityId);
      rows.push({
        date:e.date,
        time:a?.time || '—',
        title:a?.title || 'Atividade removida',
        context:a?.category || 'Rotina',
        status:e.status,
        updated:e.updatedAt || e.date
      });
    });

    todoTasks.filter(t => ['done','skipped'].includes(t.status)).forEach(t => {
      const date = t.dueDate || String(t.updatedAt || '').slice(0,10) || todayKey();
      rows.push({
        date,
        time:t.dueTime || '—',
        title:`Tarefa: ${t.title}`,
        context:activityName(t.activityId) || t.project || 'To Do',
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
      const hay = `${t.title} ${t.project || ''} ${activityName(t.activityId)}`.toLowerCase();
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
      (!todoSearch || `${t.title} ${t.project || ''} ${activityName(t.activityId)}`.toLowerCase().includes(todoSearch.toLowerCase()))
    ).sort(taskSort);
  }

  function renderTodo() {
    const today = todayKey();
    const todayTasks = todoTasks.filter(t => t.dueDate === today);
    const pending = todoTasks.filter(t => ['pending','progress'].includes(t.status));
    const doneToday = todayTasks.filter(t => t.status === 'done');
    const overdue = todoTasks.filter(t => ['pending','progress'].includes(t.status) && t.dueDate && t.dueDate < today);

    $('#todoTodayCount').textContent = todayTasks.length;
    $('#todoPendingCount').textContent = pending.length;
    $('#todoDoneCount').textContent = doneToday.length;
    $('#todoOverdueCount').textContent = overdue.length;

    const routineFilter = $('#todoRoutineFilter');
    routineFilter.innerHTML = '<option value="">Todas as rotinas</option>' +
      [...activities].sort((a,b) => a.title.localeCompare(b.title)).map(a => `<option value="${a.id}">${esc(a.title)}</option>`).join('');
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
    const activity = activityName(t.activityId);
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

    $('#editDrawerTask').onclick = () => openTaskModal(task.id);
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
    const updated = await api(`/api/tasks/${id}/status`, {
      method:'PUT',
      body:JSON.stringify({ status })
    });
    todoTasks = todoTasks.map(t => t.id === id ? updated : t);
    renderAll();
    if (activeTaskId === id) renderTaskDrawer();
    toast(statusLabel(status));
  }

  function renderTaskSelects() {
    const options = '<option value="">Sem rotina vinculada</option>' +
      [...activities].filter(a => a.active).sort((a,b) => a.title.localeCompare(b.title))
        .map(a => `<option value="${a.id}">${esc(a.title)}</option>`).join('');
    $('#taskActivity').innerHTML = options;
  }

  function openTaskModal(id = '', presetActivityId = '') {
    const form = $('#taskForm');
    form.reset();
    renderTaskSelects();

    $('#taskId').value = '';
    $('#taskRequestId').value = uuid();
    $('#taskPriority').value = 'medium';
    $('#taskDueDate').value = key(selected);
    $('#taskActivity').value = presetActivityId || '';
    $('#taskModalTitle').textContent = id ? 'Editar tarefa' : 'Nova tarefa';

    if (id) {
      const task = todoTasks.find(t => t.id === id);
      if (!task) return;
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
    const saved = id
      ? await api('/api/tasks/' + id, { method:'PUT', body:JSON.stringify(payload) })
      : await api('/api/tasks', { method:'POST', body:JSON.stringify(payload) });

    todoTasks = todoTasks.filter(t => t.id !== saved.id);
    todoTasks.push(saved);
    return saved;
  }

  function openActivityModal(id = '') {
    const form = $('#activityForm');
    form.reset();
    $('#activityId').value = '';
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
    todoScope = 'all';
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
      performance:['INDICADORES','Desempenho','Acompanhe a evolução da sua aderência.'],
      history:['RASTREABILIDADE','Histórico','Veja o que foi concluído, iniciado ou não realizado.']
    }[view];

    $('#pageEyebrow').textContent = meta[0];
    $('#pageTitle').textContent = meta[1];
    $('#pageSubtitle').textContent = meta[2];

    const action = $('#headerAction');
    if (view === 'todo') {
      action.textContent = '+ Nova tarefa';
      action.onclick = () => openTaskModal();
    } else {
      action.textContent = '+ Nova atividade';
      action.onclick = () => openActivityModal();
    }

    if (view === 'todo') renderTodo();
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
  $('#newTask').onclick = () => openTaskModal();

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
      [activities, executions, todoTasks] = await Promise.all([
        api('/api/activities'),
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