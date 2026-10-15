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

    $$('[data-edit-activity]').forEach(b => b.onclick = () => openActivityModal(b.dataset.editActivity));
    $$('[data-routine-new-task]').forEach(b => b.onclick = () => openTaskModal('', b.dataset.routineNewTask));
    $$('[data-routine-tasks]').forEach(b => b.onclick = () => openTasksForActivity(b.dataset.routineTasks));
    $$('[data-toggle-activity]').forEach(b => b.onclick = async () => {
      const a = activities.find(x => x.id === b.dataset.toggleActivity);
      if (!a) return;
      await saveActivity({...a, active: !a.active});
      toast('Atividade atualizada');
    });
    $$('[data-delete-activity]').forEach(b => b.onclick = async () => {
      const id = b.dataset.deleteActivity;
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
          active: false,
          archivedAt: new Date().toISOString()
        };
        allActivities = allActivities.filter(x => x.id !== id);
        allActivities.push(archivedSnapshot);
      }

      activities = activities.filter(x => x.id !== id);
      renderAll();
      toast('Rotina arquivada; histórico preservado');
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
    // Fundo oficial do card padrão: céu escuro, pôr do sol laranja e montanhas.
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#17191c');
    sky.addColorStop(.18, '#101214');
    sky.addColorStop(.37, '#0c0d0f');
    sky.addColorStop(.48, '#17100d');
    sky.addColorStop(.62, '#0a0b0c');
    sky.addColorStop(1, '#08090a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const horizonGlow = ctx.createRadialGradient(
      width * .80, height * .43, 8,
      width * .80, height * .43, width * .62
    );
    horizonGlow.addColorStop(0, 'rgba(255,181,88,.88)');
    horizonGlow.addColorStop(.10, 'rgba(255,125,30,.54)');
    horizonGlow.addColorStop(.30, 'rgba(190,64,8,.26)');
    horizonGlow.addColorStop(.62, 'rgba(73,26,10,.10)');
    horizonGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = horizonGlow;
    ctx.fillRect(0, 0, width, height);

    const cloudGlow = ctx.createLinearGradient(0, height * .34, 0, height * .52);
    cloudGlow.addColorStop(0, 'rgba(255,112,20,0)');
    cloudGlow.addColorStop(.48, 'rgba(255,104,18,.10)');
    cloudGlow.addColorStop(1, 'rgba(255,86,0,0)');
    ctx.fillStyle = cloudGlow;
    ctx.fillRect(0, height * .30, width, height * .25);

    const sunX = width * .825;
    const sunY = height * .445;
    const sunRadius = 62;

    const sunHalo = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 145);
    sunHalo.addColorStop(0, 'rgba(255,220,145,.92)');
    sunHalo.addColorStop(.22, 'rgba(255,146,57,.64)');
    sunHalo.addColorStop(1, 'rgba(255,112,23,0)');
    ctx.fillStyle = sunHalo;
    ctx.fillRect(sunX - 160, sunY - 160, 320, 320);

    ctx.fillStyle = '#ffb357';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
    ctx.fill();

    function drawMountain(points, fill, shadow = null) {
      ctx.save();
      if (shadow) {
        ctx.shadowColor = shadow;
        ctx.shadowBlur = 32;
      }
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(0, height * .54);
      points.forEach(([x,y]) => ctx.lineTo(width * x, height * y));
      ctx.lineTo(width, height * .56);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    drawMountain([
      [.02,.475],[.075,.455],[.12,.420],[.17,.470],[.22,.447],[.27,.485],
      [.33,.452],[.39,.492],[.46,.462],[.53,.505],[.61,.472],[.68,.505],
      [.75,.475],[.81,.500],[.86,.444],[.91,.412],[.96,.455]
    ], '#17181a', 'rgba(255,103,17,.12)');

    drawMountain([
      [.00,.505],[.06,.480],[.13,.452],[.19,.505],[.26,.472],[.33,.520],
      [.40,.484],[.48,.531],[.57,.489],[.64,.536],[.72,.496],[.79,.526],
      [.86,.474],[.93,.450],[1,.508]
    ], '#0e0f10');

    drawMountain([
      [.00,.535],[.08,.508],[.15,.485],[.23,.540],[.31,.505],[.39,.552],
      [.48,.516],[.57,.558],[.66,.523],[.75,.559],[.83,.520],[.91,.500],[1,.548]
    ], '#070809');

    ctx.strokeStyle = 'rgba(255,117,31,.18)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(width * .80, height * .515);
    ctx.lineTo(width * .865, height * .445);
    ctx.lineTo(width * .925, height * .486);
    ctx.stroke();

    const vignette = ctx.createRadialGradient(
      width / 2, height * .45, width * .10,
      width / 2, height * .45, width * .78
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(.72, 'rgba(0,0,0,.16)');
    vignette.addColorStop(1, 'rgba(0,0,0,.72)');
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
    ctx.filter = 'brightness(.54) saturate(.9) contrast(1.08)';
    ctx.drawImage(
      image,
      sourceX, sourceY, sourceWidth, sourceHeight,
      0, 0, width, height
    );
    ctx.restore();

    const overlay = ctx.createLinearGradient(0, 0, 0, height);
    overlay.addColorStop(0, 'rgba(8,9,11,.58)');
    overlay.addColorStop(.40, 'rgba(8,9,11,.24)');
    overlay.addColorStop(.72, 'rgba(8,9,11,.44)');
    overlay.addColorStop(1, 'rgba(8,9,11,.78)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, width, height);

    const warm = ctx.createRadialGradient(width * .82, height * .42, 0, width * .82, height * .42, width * .50);
    warm.addColorStop(0, 'rgba(255,120,23,.22)');
    warm.addColorStop(1, 'rgba(255,120,23,0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, width, height);
  }

  function drawShareTitle(ctx, canvasWidth) {
    const meuText = 'Meu';
    const desempenhoText = 'desempenho';
    const gap = 24;

    ctx.font = '800 76px Arial';
    const meuWidth = ctx.measureText(meuText).width;
    const desempenhoWidth = ctx.measureText(desempenhoText).width;
    const totalWidth = meuWidth + gap + desempenhoWidth;
    const startX = (canvasWidth - totalWidth) / 2;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#f5f5f5';
    ctx.fillText(meuText, startX, 245);
    ctx.fillStyle = '#ff7a1a';
    ctx.fillText(desempenhoText, startX + meuWidth + gap, 245);
  }

  function drawShareMetricIcon(ctx, x, y, accent) {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#111214';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x - 2, y + 8);
    ctx.lineTo(x + 12, y - 9);
    ctx.stroke();
  }

  let standardPerformanceTemplatePromise = null;

  function loadStandardPerformanceTemplate() {
    if (!standardPerformanceTemplatePromise) {
      standardPerformanceTemplatePromise = new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Não foi possível carregar o modelo padrão.'));
        image.src = '/assets/share/performance-standard.webp?v=20261015-1';
      });
    }
    return standardPerformanceTemplatePromise;
  }

  function coverTemplateValue(ctx, x, y, w, h, radius = 18) {
    roundRectPath(ctx, x, y, w, h, radius);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, 'rgba(16,17,19,.98)');
    g.addColorStop(1, 'rgba(10,11,13,.98)');
    ctx.fillStyle = g;
    ctx.fill();
  }

  function fitMetricFont(ctx, text, maxWidth, startSize, minSize = 30) {
    let size = startSize;
    while (size > minSize) {
      ctx.font = `800 ${size}px Arial`;
      if (ctx.measureText(text).width <= maxWidth) return size;
      size -= 2;
    }
    return minSize;
  }

  async function standardPerformanceShareBlob(stats, evolution, sequence) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    const template = await loadStandardPerformanceTemplate();

    ctx.drawImage(template, 0, 0, canvas.width, canvas.height);

    // Atualiza o anel da aderência mantendo o layout do template.
    const cx = 566;
    const cy = 731;
    const radius = 271;
    const adherence = Math.max(0, Math.min(100, stats.adherence));

    ctx.lineWidth = 42;
    ctx.strokeStyle = 'rgba(54,55,58,.96)';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();

    const ring = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    ring.addColorStop(0, '#ff6b13');
    ring.addColorStop(.55, '#ff8c22');
    ring.addColorStop(1, '#ffba50');
    ctx.strokeStyle = ring;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (adherence / 100));
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Percentual central.
    coverTemplateValue(ctx, 360, 603, 410, 168, 70);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    const adherenceText = adherence + '%';
    fitMetricFont(ctx, adherenceText, 365, 162, 112);
    ctx.fillText(adherenceText, 565, 690);

    // Indicadores dos quatro cards.
    const metrics = [
      {
        text:`${stats.completedActivities} / ${stats.totalActivities}`,
        box:[238,1055,220,100], x:248, y:1117, max:200, size:58
      },
      {
        text:String(sequence),
        box:[742,1055,190,100], x:754, y:1117, max:165, size:60
      },
      {
        text:signedPercent(evolution),
        box:[238,1292,220,102], x:248, y:1355, max:200, size:58,
        color:evolution < 0 ? '#ff6876' : '#ffffff'
      },
      {
        text:`${stats.consistentDays} / ${stats.plannedDays}`,
        box:[742,1292,220,102], x:752, y:1355, max:205, size:55
      }
    ];

    metrics.forEach(metric => {
      coverTemplateValue(ctx, ...metric.box, 12);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = metric.color || '#ffffff';
      fitMetricFont(ctx, metric.text, metric.max, metric.size, 34);
      ctx.fillText(metric.text, metric.x, metric.y);
    });

    // Mês/ano.
    coverTemplateValue(ctx, 345, 1770, 390, 78, 6);
    const month = new Intl.DateTimeFormat('pt-BR', {
      month:'long',
      year:'numeric'
    }).format(new Date()).toUpperCase();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#aeb0b4';
    ctx.font = '500 27px Arial';
    ctx.fillText(month, 540, 1811);

    return await new Promise(resolve =>
      canvas.toBlob(blob => resolve(blob), 'image/png', 0.97)
    );
  }

  async function performanceShareBlob(stats, evolution, sequence, backgroundImage = null) {
    if (!backgroundImage) {
      return await standardPerformanceShareBlob(stats, evolution, sequence);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');

    drawImageCover(ctx, backgroundImage, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(255,120,23,.30)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-30, 100, 260, -.8, 1.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(1080, 720, 330, 2.1, 4.7);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f5f5f5';
    ctx.font = '600 48px Arial';
    ctx.fillText('R O U T I N E', 540, 120);

    drawShareTitle(ctx, canvas.width);

    ctx.fillStyle = '#bfc1c5';
    ctx.font = '500 25px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('DISCIPLINA HOJE. UMA VIDA MELHOR AMANHÃ.', 540, 315);

    const cx = 540, cy = 650, radius = 225;
    ctx.lineWidth = 34;
    ctx.strokeStyle = 'rgba(54,56,60,.86)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();

    const ring = ctx.createLinearGradient(330, 430, 760, 850);
    ring.addColorStop(0, '#ffb14f');
    ring.addColorStop(1, '#ef5e00');
    ctx.strokeStyle = ring;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (stats.adherence / 100));
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.fillStyle = 'rgba(10,11,13,.58)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 23, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 145px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(stats.adherence + '%', cx, cy + 25);
    ctx.font = '500 34px Arial';
    ctx.fillStyle = '#d2d4d7';
    ctx.fillText('ADERÊNCIA', cx, cy + 95);

    ctx.fillStyle = '#42dc8a';
    const glyphBaseY = cy + 150;
    [22,34,49].forEach((h, i) => {
      const x = cx - 28 + i * 22;
      ctx.fillRect(x, glyphBaseY - h, 10, h);
    });

    const cards = [
      {x:70,y:980,w:450,h:220,value:`${stats.completedActivities} / ${stats.totalActivities}`,label:'ATIVIDADES CONCLUÍDAS',accent:'#ff7a1a'},
      {x:560,y:980,w:450,h:220,value:`${sequence}`,label:'DIAS DE SEQUÊNCIA',accent:'#ff7a1a'},
      {x:70,y:1235,w:450,h:220,value:signedPercent(evolution),label:'DE EVOLUÇÃO',accent:evolution < 0 ? '#ff6675' : '#43d889'},
      {x:560,y:1235,w:450,h:220,value:`${stats.consistentDays} / ${stats.plannedDays}`,label:'DIAS CONSISTENTES',accent:'#ff7a1a'}
    ];

    cards.forEach(card => {
      roundRectPath(ctx, card.x, card.y, card.w, card.h, 28);
      ctx.fillStyle = 'rgba(15,16,18,.82)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = 2;
      ctx.stroke();

      drawShareMetricIcon(ctx, card.x + 68, card.y + 72, card.accent);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 58px Arial';
      ctx.fillText(card.value, card.x + 125, card.y + 100);
      ctx.fillStyle = '#c0c3c7';
      ctx.font = '500 25px Arial';
      ctx.fillText(card.label, card.x + 125, card.y + 150);
    });

    roundRectPath(ctx, 70, 1510, 940, 230, 30);
    const callout = ctx.createLinearGradient(70, 1510, 1010, 1740);
    callout.addColorStop(0, 'rgba(20,20,21,.90)');
    callout.addColorStop(1, 'rgba(50,25,13,.90)');
    ctx.fillStyle = callout;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,120,23,.58)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 52px Arial';
    ctx.fillText('Meu melhor ritmo até agora.', 540, 1605);
    ctx.fillStyle = '#ff7a1a';
    ctx.font = '700 38px Arial';
    ctx.fillText(`${stats.adherence}% de aderência nos últimos 30 dias`, 540, 1670);

    const month = new Intl.DateTimeFormat('pt-BR', { month:'long', year:'numeric' }).format(new Date()).toUpperCase();
    ctx.fillStyle = '#a0a3a8';
    ctx.font = '500 28px Arial';
    ctx.fillText(month, 540, 1835);

    return await new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png', 0.96));
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