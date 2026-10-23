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

export const homeView: View = (context, root) => {
  const chip = statusChip(context.store);

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

  const [camera, ...others] = [items[2]!, ...items.filter((_, index) => index !== 2)];
  const cta = h(
    'button',
    { class: 'home-cta', type: 'button', onclick: camera.run },
    icon('camera'),
    h('span', { class: 'home-cta-text' }, h('span', { class: 'home-cta-title' }, camera.title), h('span', { class: 'home-cta-hint' }, camera.hint)),
  );
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

  return () => chip.destroy();
};
