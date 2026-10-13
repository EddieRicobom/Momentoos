import { checkCapabilities } from '../capabilities';
import { topBar } from './components';
import type { View } from './context';
import { h } from './dom';

export const settingsView: View = (context, root) => {
  const capabilities = checkCapabilities();

  root.append(
    h(
      'main',
      { class: 'screen' },
      topBar('Configurações', () => context.navigate('home')),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Compatibilidade deste navegador'),
        h(
          'ul',
          { class: 'checks' },
          ...capabilities.map((item) =>
            h(
              'li',
              { class: 'check', 'data-ok': item.ok ? 'true' : 'false' },
              h('span', { class: 'check-mark', 'aria-hidden': 'true' }, item.ok ? '✓' : '✕'),
              h(
                'span',
                null,
                h('strong', null, item.label),
                h('span', { class: 'muted block' }, item.detail),
              ),
            ),
          ),
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Privacidade'),
        h(
          'p',
          { class: 'muted' },
          'Fotos, alvos e projetos ficam neste aparelho. O app não envia imagens para ninguém, não tem conta, não usa telemetria nem anúncios. A câmera só é pedida quando você abre a tela da câmera.',
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Funcionamento offline'),
        h(
          'p',
          { class: 'muted' },
          'Ainda não disponível: o modo offline (instalação como app) chega na Etapa E. Hoje o app precisa de internet para ser aberto. Depois de aberto, compilar o alvo e rastrear acontecem no aparelho, sem rede.',
        ),
        h(
          'p',
          { class: 'muted' },
          'Vídeos incorporados do YouTube (Etapa D) vão depender de internet e das regras do próprio YouTube.',
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Dados locais e backup'),
        h(
          'p',
          { class: 'muted' },
          'Limpar os dados do navegador ou desinstalar o app apaga o que estiver guardado aqui. Quando os projetos passarem a ser salvos (Etapa C), exporte backups com frequência. Por enquanto, baixe o alvo .mind em "Criar âncora" se quiser guardá-lo.',
        ),
      ),
    ),
  );

  return () => {};
};
