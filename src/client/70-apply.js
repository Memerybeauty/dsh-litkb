    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-dsh-plugin', 'dsh-litkb')
        style.textContent = SHARED.CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dsh-litkb: styles')

      ctx.slots.inject(
        'sidebar.panellist',
        () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'dsh-litkb',
          order: 20,
          label: () => '文献工作台',
        }, SHARED.LitkbIcon),
        'dsh-litkb: sidebar panel icon'
      )

      ctx.slots.inject(
        'main',
        () => ctx.slots.register({ name: 'main', key: 'dsh-litkb' }, SHARED.LibraryPage),
        'dsh-litkb: native main panel'
      )

      ctx.slots.inject(
        'settings.section',
        () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-litkb',
          order: 30,
          label: () => '文献工作台',
        }, SHARED.LitkbSettings),
        'dsh-litkb: settings section'
      )
    }

    return { name: 'dsh-litkb', inject: ['slots'], apply }
  },
})
