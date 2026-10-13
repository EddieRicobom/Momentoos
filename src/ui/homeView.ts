import { h } from './dom';
import { statusChip } from './components';
import type { View } from './context';

interface MenuItem {
  title: string;
  hint: string;
  run(): void;
}

export const homeView: View = (context, root) => {
  const chip = statusChip(context.store);

  const items: MenuItem[] = [
    {
      title: 'Meus projetos',
      hint: 'Projetos guardados no aparelho',
      run: () => context.navigate('projects'),
    },
    {
      title: 'Criar âncora',
      hint: 'Foto da tatuagem → alvo de rastreamento',
      run: () => context.navigate('create'),
    },
    {
      title: 'Abrir câmera',
      hint: 'Procurar a tatuagem e ver o objeto virtual',
      run: () => {
        if (!context.getTarget()) {
          context.toast('A câmera precisa de um alvo: abra um projeto salvo ou crie uma âncora.');
          context.navigate('projects');
          return;
        }
        context.navigate('camera');
      },
    },
    {
      title: 'Importar projeto',
      hint: 'Trazer um backup de outro aparelho',
      run: () => context.navigate('import'),
    },
    {
      title: 'Exportar backup',
      hint: 'Levar seus projetos para outro aparelho',
      run: () => context.navigate('export'),
    },
    {
      title: 'Configurações',
      hint: 'Compatibilidade, privacidade e dados locais',
      run: () => context.navigate('settings'),
    },
  ];

  const list = h(
    'ul',
    { class: 'menu' },
    ...items.map((item) =>
      h(
        'li',
        null,
        h(
          'button',
          { class: 'menu-item', type: 'button', onclick: item.run },
          h('span', { class: 'menu-title' }, item.title),
          h('span', { class: 'menu-hint' }, item.hint),
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
        h('h1', { class: 'hero-title' }, 'Tattoo AR'),
        h(
          'p',
          { class: 'hero-sub' },
          'Conteúdo digital preso à sua tatuagem, reconhecida pela câmera. Tudo roda neste aparelho: nenhuma foto sai daqui.',
        ),
        chip.element,
      ),
      list,
      h(
        'p',
        { class: 'footnote' },
        'Protótipo em desenvolvimento (Etapas A, B e C). O reconhecimento em tatuagens reais e o salvamento no celular ainda precisam ser testados no aparelho: veja docs/TESTES-MANUAIS.md.',
      ),
    ),
  );

  return () => chip.destroy();
};
