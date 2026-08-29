export type SecondaryProjectView = 'photos' | 'work-items' | 'daily-records' | 'reports';
export type ProjectView = 'ledger' | SecondaryProjectView;

export type ProjectQuery = {
  view: ProjectView;
  day?: string;
  review: boolean;
  focus?: string;
};

export type ProjectQueryAction =
  | { kind: 'open-view'; view: SecondaryProjectView }
  | { kind: 'open-day'; day: string; focus?: string }
  | { kind: 'open-review'; focus?: string }
  | { kind: 'close-view' }
  | { kind: 'close-day' }
  | { kind: 'close-review' };

const VIEWS = new Set<SecondaryProjectView>(['photos', 'work-items', 'daily-records', 'reports']);
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function parseProjectQuery(params: URLSearchParams): ProjectQuery {
  const rawView = params.get('view');
  if (rawView && VIEWS.has(rawView as SecondaryProjectView)) {
    return { view: rawView as SecondaryProjectView, review: false };
  }

  const day = params.get('day');
  const review = params.get('review') === '1' || params.get('tab') === 'closeout';
  const validDay = day && DATE_KEY.test(day) ? day : undefined;
  const focus = params.get('focus')?.trim();
  return {
    view: 'ledger',
    ...(validDay ? { day: validDay } : {}),
    review,
    ...(focus && (validDay || review) ? { focus } : {}),
  };
}

export function patchProjectQuery(
  current: URLSearchParams,
  action: ProjectQueryAction,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (action.kind === 'open-view') {
    next.delete('tab');
    next.delete('day');
    next.delete('review');
    next.delete('focus');
    next.set('view', action.view);
    return next;
  }

  if (action.kind === 'close-view') {
    next.delete('tab');
    next.delete('view');
    next.delete('day');
    next.delete('review');
    next.delete('focus');
    return next;
  }

  next.delete('view');
  if (action.kind === 'open-day') {
    next.set('day', action.day);
    if (action.focus) next.set('focus', action.focus);
    else next.delete('focus');
  } else if (action.kind === 'open-review') {
    next.delete('tab');
    next.set('review', '1');
    if (action.focus) next.set('focus', action.focus);
    else next.delete('focus');
  } else if (action.kind === 'close-day') {
    next.delete('day');
    next.delete('focus');
  } else {
    next.delete('tab');
    next.delete('review');
    next.delete('focus');
  }
  return next;
}
