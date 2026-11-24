import { h } from './dom';
import { statusChip } from './components';
import { icon, type IconName } from './icons';
import type { View } from './context';

interface MenuItem {
  title: string;
  hint: string;
  icon: IconName;
  run(): void;
}

type CtaMode = 'camera' | 'create' | 'projects';

const CTA_INFO: Record<CtaMode, { title: string; hint: string; icon: IconName }> = {
  camera: {
    title: 'Rever na câmera',
    hint: 'Aponte para a tatuagem e reveja os momentos guardados',
    icon: 'camera',
  },
  create: {
    title: 'Criar uma lembrança',
    hint: 'Fotografe a tatuagem e comece a guardar momentos nela',
    icon: 'plus',
  },
  projects: {
    title: 'Abrir minhas lembranças',
    hint: 'Toque numa tatuagem salva para rever ou organizar',
    icon: 'folder',
  },
};

export const homeView: View = (context, root) => {
  const chip = statusChip(context.store);
  let disposed = false;
  let ctaMode: CtaMode = context.getTarget() ? 'camera' : 'create';

  const countLine = h('p', { class: 'home-count muted', role: 'status' });
  countLine.hidden = true;

  const items: MenuItem[] = [
    {
      title: 'Minhas lembranças',
      hint: 'Tatuagens e momentos guardados neste aparelho',
      icon: 'folder',
      run: () => context.navigate('projects'),
    },
    {
      title: 'Criar uma lembrança',
      hint: 'Escolha uma tatuagem para reencontrar seus momentos',
      icon: 'plus',
      run: () => context.navigate('create'),
    },
    {
      title: 'Rever na câmera',
      hint: 'Aponte para a tatuagem e reveja os momentos guardados',
      icon: 'camera',
      run: () => {
        if (!context.getTarget()) {
          context.toast('Para rever suas lembranças, abra uma tatuagem salva ou crie uma nova.');
          context.navigate('projects');
          return;
        }
        context.navigate('camera');
      },
    },
    {
      title: 'Importar lembranças',
      hint: 'Restaurar um backup de outro aparelho',
      icon: 'import',
      run: () => context.navigate('import'),
    },
    {
      title: 'Exportar backup',
      hint: 'Levar suas lembranças para outro aparelho',
      icon: 'export',
      run: () => context.navigate('export'),
    },
    {
      title: 'Configurações',
      hint: 'Compatibilidade, privacidade e dados locais',
      icon: 'settings',
      run: () => context.navigate('settings'),
    },
  ];

  function runCta(): void {
    if (ctaMode === 'camera') {
      if (!context.getTarget()) {
        context.toast('Para rever suas lembranças, abra uma tatuagem salva ou crie uma nova.');
        context.navigate('projects');
        return;
      }
      context.navigate('camera');
      return;
    }
    context.navigate(ctaMode === 'projects' ? 'projects' : 'create');
  }

  const cta = h('button', { class: 'home-cta', type: 'button', onclick: runCta });

  function renderCta(): void {
    const info = CTA_INFO[ctaMode];
    cta.dataset.mode = ctaMode;
    cta.setAttribute('aria-label', `${info.title}. ${info.hint}.`);
    cta.replaceChildren(
      icon(info.icon),
      h('span', { class: 'home-cta-text' }, h('span', { class: 'home-cta-title' }, info.title), h('span', { class: 'home-cta-hint' }, info.hint)),
    );
  }
  renderCta();

  const others = items.filter((_, index) => index !== 2);
  const list = h(
    'ul',
    { class: 'tile-grid' },
    ...others.map((item) =>
      h(
        'li',
        null,
        h(
          'button',
          { class: 'tile', type: 'button', onclick: item.run },
          icon(item.icon),
          h('span', { class: 'tile-title' }, item.title),
          h('span', { class: 'tile-hint' }, item.hint),
        ),
      ),
    ),
  );

  // A ação principal acompanha o que já existe no aparelho: criar na primeira
  // vez, abrir uma lembrança salva depois, rever na câmera quando já há alvo.
  void (async () => {
    try {
      const repo = await context.getRepository();
      const entries = await repo.list();
      if (disposed) return;
      const count = entries.filter((entry) => entry.kind === 'project').length;
      countLine.hidden = false;
      countLine.textContent = count === 0
        ? 'Nenhuma lembrança guardada ainda. Comece pela sua tatuagem.'
        : `${count} ${count === 1 ? 'lembrança guardada' : 'lembranças guardadas'} neste aparelho.`;
      ctaMode = context.getTarget() ? 'camera' : count > 0 ? 'projects' : 'create';
      renderCta();
    } catch {
      // Sem acesso ao armazenamento, a tela continua útil no modo "criar".
    }
  })();

  root.append(
    h(
      'main',
      { class: 'screen' },
      h(
        'header',
        { class: 'hero' },
        h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('scan')), h('h1', { class: 'hero-title' }, 'Momentoos')),
        h(
          'p',
          { class: 'hero-sub' },
          'Associe fotos, vídeos e sons a uma tatuagem para reencontrar seus momentos na câmera. Tudo fica neste aparelho.',
        ),
        chip.element,
        countLine,
      ),
      cta,
      h('ol', { class: 'home-steps', 'aria-label': 'Como guardar seus momentos' },
        h('li', {}, h('strong', {}, '1. Sua tatuagem'), h('span', {}, 'Escolha uma foto nítida.')),
        h('li', {}, h('strong', {}, '2. Seus momentos'), h('span', {}, 'Adicione e experimente um layout.')),
        h('li', {}, h('strong', {}, '3. Ganham vida'), h('span', {}, 'Escolha movimentos e reveja na câmera.'))),
      list,
      h(
        'p',
        { class: 'footnote' },
        'Protótipo em desenvolvimento. Experimente com boa iluminação e confira o resultado no seu aparelho. Exporte um backup para guardar suas lembranças em outro lugar.',
      ),
    ),
  );

  return () => {
    disposed = true;
    chip.destroy();
  };
};
