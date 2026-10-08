// Скопируйте папку `hello-world` в `<хранилище>/.flint/plugins/` и включите плагин в настройках.
// Глобальный объект `flint` это публичный API приложения (см. src/api.ts).

export default class HelloWorld extends flint.Plugin {
  onload() {
    this.addCommand({
      id: 'greet',
      name: 'Hello World: поздороваться',
      callback: () => this.app.notice('Привет из стороннего плагина!'),
    })
  }
}
