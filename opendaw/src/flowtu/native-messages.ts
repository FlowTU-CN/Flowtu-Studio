// These selectors cover only fixed controls. Project, track, cue, marker and note text are user data.
export const nativeCaptions = [
    '.ft-timeline-controls button > span',
    '.ft-ruler-labels > span', '.ft-ruler-menu-button', '.ft-ruler-menu :is(label,button)',
    '.ft-work-label > button', '.ft-work-dialog :is(strong,label,button,output)',
    '.ft-note-editor :is(strong,button)', '.conductor-point :is(option,button)',
    '.ft-track-folder-editor :is(h3,legend,button)', '.ft-track-folder-editor form > label', '.ft-track-folder-editor option[value=""]'
] as const

export const nativeMessages = `
Rulers|标尺|Reglas|Réguas|ルーラー|눈금자
Rulers ▾|标尺 ▾|Reglas ▾|Réguas ▾|ルーラー ▾|눈금자 ▾
Conductor|指挥轨|Director|Regência|コンダクター|컨덕터
Conductor tracks|指挥轨道|Pistas de director|Faixas de regência|コンダクタートラック|컨덕터 트랙
Tempo track|速度轨|Pista de tempo|Faixa de andamento|テンポトラック|템포 트랙
Time signature track|拍号轨|Pista de compás|Faixa de fórmula de compasso|拍子トラック|박자표 트랙
Show tempo, time signature and marker tracks|显示速度、拍号与标记轨|Mostrar pistas de tempo, compás y marcadores|Mostrar faixas de andamento, compasso e marcadores|テンポ・拍子・マーカートラックを表示|템포, 박자표 및 마커 트랙 표시
Tempo|速度|Tempo|Andamento|テンポ|템포
Time signature|拍号|Compás|Fórmula de compasso|拍子|박자표
Cues|配乐段落|Cues|Deixas|キュー|큐
Work Area ▾|工作区 ▾|Área de trabajo ▾|Área de trabalho ▾|作業範囲 ▾|작업 구간 ▾
Work Area / Loop|工作区 / 循环|Área de trabajo / Bucle|Área de trabalho / Loop|作業範囲 / ループ|작업 구간 / 루프
Seconds|秒|Segundos|Segundos|秒|초
Samples|采样|Muestras|Amostras|サンプル|샘플
User frame rate|自定帧率|Frecuencia de fotogramas personalizada|Taxa de quadros personalizada|カスタムフレームレート|사용자 지정 프레임률
User ruler frame rate|标尺自定帧率|Frecuencia de fotogramas de la regla|Taxa de quadros da régua|ルーラーのフレームレート|눈금자 프레임률
{0} fps (User)|{0} fps（自定）|{0} fps (personalizado)|{0} fps (personalizado)|{0} fps（カスタム）|{0} fps (사용자 지정)
Project audio · {0} Hz|工程音频 · {0} Hz|Audio del proyecto · {0} Hz|Áudio do projeto · {0} Hz|プロジェクトの音声 · {0} Hz|프로젝트 오디오 · {0} Hz
Bars / Beats|小节 / 拍|Compases / Tiempos|Compassos / Tempos|小節 / 拍|마디 / 박
Add note at playhead…|在播放头添加注释…|Añadir nota en el cursor…|Adicionar anotação no cursor…|再生ヘッド位置にメモを追加…|재생 헤드에 메모 추가…
Timeline note|时间线注释|Nota de la línea de tiempo|Anotação da linha do tempo|タイムラインのメモ|타임라인 메모
Note text|注释文本|Texto de la nota|Texto da anotação|メモの内容|메모 내용
Set loop and export locators · P sets them to the selection|设置循环和导出范围，按 P 对齐选区|Ajustar los límites de bucle y exportación. P usa la selección.|Defina os limites de loop e exportação. P usa a seleção.|ループと書き出し範囲を設定。P で選択範囲に合わせます。|루프와 내보내기 범위를 설정합니다. P를 누르면 선택 범위에 맞춥니다.
Export work area|导出工作区|Área de exportación|Área de exportação|書き出し範囲|내보내기 구간
Loop & export work area|循环与导出工作区|Área de bucle y exportación|Área de loop e exportação|ループ・書き出し範囲|루프 및 내보내기 구간
In|入点|Entrada|Entrada|イン点|시작점
Out|出点|Salida|Saída|アウト点|종료점
Use selection · P|使用选区 · P|Usar selección · P|Usar seleção · P|選択範囲を使用 · P|선택 구간 사용 · P
Auto · full project|自动 · 整个工程|Auto · Proyecto completo|Auto · Projeto inteiro|自動 · プロジェクト全体|자동 · 전체 프로젝트
Apply|应用|Aplicar|Aplicar|適用|적용
Enter valid In and Out times.|请输入有效的入点和出点时间。|Introduce tiempos de entrada y salida válidos.|Insira tempos de entrada e saída válidos.|有効なイン点とアウト点を入力してください。|유효한 시작 및 종료 시간을 입력하세요.
Set Out after In, within the timeline.|出点必须位于入点之后，且在时间线内。|Sitúa la salida después de la entrada, dentro de la línea de tiempo.|Defina a saída após a entrada, dentro da linha do tempo.|アウト点はタイムライン内でイン点より後に設定してください。|타임라인 안에서 종료점을 시작점 뒤에 설정하세요.
Export work area ruler|导出工作区标尺|Regla del área de exportación|Régua da área de exportação|書き出し範囲ルーラー|내보내기 구간 눈금자
Drag to set loop and export bounds. Alt-drag to move. Shift bypasses snap. Double-click to toggle loop.|拖动设置循环和导出边界。按住 Alt 拖动可移动，Shift 可暂时关闭吸附。连按两次切换循环。|Arrastra para definir el bucle y la exportación. Alt y arrastrar mueve el rango. Mayús desactiva el ajuste. Doble clic activa o desactiva el bucle.|Arraste para definir os limites de loop e exportação. Alt e arrastar move a faixa. Shift ignora o ajuste. Clique duas vezes para alternar o loop.|ドラッグでループ・書き出し範囲を設定。Alt＋ドラッグで移動、Shift でスナップを一時解除。ダブルクリックでループを切り替えます。|드래그해 루프와 내보내기 범위를 설정합니다. Alt를 누르고 드래그해 이동하고 Shift로 스냅을 해제합니다. 더블 클릭으로 루프를 전환합니다.
Auto|自动|Auto|Auto|自動|자동
Add instrument|添加乐器|Añadir instrumento|Adicionar instrumento|音源を追加|악기 추가
Drop instruments or samples here|将乐器或采样拖到此处|Arrastra instrumentos o muestras aquí|Arraste instrumentos ou amostras para cá|ここに音源またはサンプルをドロップ|여기에 악기 또는 샘플 놓기
bar|小节|comp.|comp.|小節|마디
beat|拍|pulso|tempo|拍|박
meter|拍号|compás|fórmula|拍子|박자표
semi|十六分|semic.|semic.|16分|16분
ticks|脉冲|ticks|ticks|ティック|틱
hr|时|h|h|時|시
min|分|min|min|分|분
sec|秒|s|s|秒|초
fr|帧|fot.|qd.|フレーム|프레임
sub|子帧|subf.|subq.|サブフレーム|하위 프레임
Online|在线|En línea|Online|オンライン|온라인
Yes|是|Sí|Sim|はい|예
No|否|No|Não|いいえ|아니요
Project|工程|Proyecto|Projeto|プロジェクト|프로젝트
SampleRate|采样率|Muestreo|Amostragem|サンプルレート|샘플률
CPU Load|CPU 负载|Carga CPU|Carga da CPU|CPU 負荷|CPU 부하
Memory|内存|Memoria|Memória|メモリ|메모리
Samples (GC)|采样（回收）|Muestras (GC)|Amostras (GC)|サンプル（GC）|샘플 (GC)
Build Version|构建版本|Versión de compilación|Versão da compilação|ビルドバージョン|빌드 버전
Build Time|构建时间|Fecha de compilación|Data da compilação|ビルド日時|빌드 시간
Sounds & Effects|音色与效果|Sonidos y efectos|Sons e efeitos|サウンドとエフェクト|사운드 및 이펙트
Notepad|记事本|Bloc de notas|Bloco de notas|メモ帳|메모장
Project Info|工程信息|Información del proyecto|Informações do projeto|プロジェクト情報|프로젝트 정보
Analysis|分析|Análisis|Análise|解析|분석
Modular System|模块系统|Sistema modular|Sistema modular|モジュラーシステム|모듈러 시스템
Dashboard|概览|Panel general|Painel geral|ダッシュボード|대시보드
Modulation|调制|Modulación|Modulação|モジュレーション|모듈레이션
Piano Tutorial Mode|钢琴教学模式|Modo de aprendizaje de piano|Modo de estudo de piano|ピアノ練習モード|피아노 학습 모드
Empty|空白|Vacío|Vazio|空|비어 있음
Code Editor|代码编辑器|Editor de código|Editor de código|コードエディター|코드 편집기
Match Tempo|匹配速度|Ajustar tempo|Ajustar andamento|テンポを合わせる|템포 맞추기
New Track|新建轨道|Nueva pista|Nova faixa|新規トラック|새 트랙
New Audio Track|新建音频轨|Nueva pista de audio|Nova faixa de áudio|新規オーディオトラック|새 오디오 트랙
New Note Track|新建音符轨|Nueva pista de notas|Nova faixa de notas|新規ノートトラック|새 노트 트랙
Delete Track|删除轨道|Eliminar pista|Excluir faixa|トラックを削除|트랙 삭제
Delete Audio Track|删除音频轨|Eliminar pista de audio|Excluir faixa de áudio|オーディオトラックを削除|오디오 트랙 삭제
Delete Note Track|删除音符轨|Eliminar pista de notas|Excluir faixa de notas|ノートトラックを削除|노트 트랙 삭제
Delete Automation Track|删除自动化轨|Eliminar pista de automatización|Excluir faixa de automação|オートメーショントラックを削除|오토메이션 트랙 삭제
Delete '{0}'|删除“{0}”|Eliminar «{0}»|Excluir “{0}”|「{0}」を削除|‘{0}’ 삭제
No Input|无输入|Sin entrada|Sem entrada|入力なし|입력 없음
Small|小|Pequeña|Pequena|小|작게
Medium|中|Mediana|Média|中|보통
Large|大|Grande|Grande|大|크게
Edit Signature|编辑拍号|Editar compás|Editar fórmula de compasso|拍子を編集|박자표 편집
Presets|预设|Preajustes|Predefinições|プリセット|프리셋
Repeat|重复|Repetir|Repetir|リピート|반복
Infinite|无限|Infinito|Infinito|無限|무한
Track folder|轨道文件夹|Carpeta de pistas|Pasta de faixas|トラックフォルダー|트랙 폴더
Remove from folder|从文件夹移出|Quitar de la carpeta|Remover da pasta|フォルダーから外す|폴더에서 제거
Track color|轨道颜色|Color de pista|Cor da faixa|トラックの色|트랙 색상
Default / folder color|默认 / 文件夹颜色|Color predeterminado / de carpeta|Cor padrão / da pasta|デフォルト / フォルダーの色|기본 / 폴더 색상
Color|颜色|Color|Cor|色|색상
Blue|蓝色|Azul|Azul|青|파랑
Orange|橙色|Naranja|Laranja|オレンジ|주황
Green|绿色|Verde|Verde|緑|초록
Red|红色|Rojo|Vermelho|赤|빨강
Purple|紫色|Morado|Roxo|紫|보라
Yellow|黄色|Amarillo|Amarelo|黄|노랑
Devices|设备|Dispositivos|Dispositivos|デバイス|장치
Capture Audio|录制音频|Grabar audio|Gravar áudio|オーディオを録音|오디오 녹음
Capture MIDI|录制 MIDI|Grabar MIDI|Gravar MIDI|MIDI を録音|MIDI 녹음
Audio Inputs|音频输入|Entradas de audio|Entradas de áudio|オーディオ入力|오디오 입력
Click to access external devices...|点击访问外部设备…|Haz clic para acceder a dispositivos externos…|Clique para acessar dispositivos externos…|クリックして外部デバイスにアクセス…|클릭하여 외부 장치에 접근…
No external devices found|未发现外部设备|No se encontraron dispositivos externos|Nenhum dispositivo externo encontrado|外部デバイスが見つかりません|외부 장치를 찾을 수 없음
All devices|所有设备|Todos los dispositivos|Todos os dispositivos|すべてのデバイス|모든 장치
All channels|所有通道|Todos los canales|Todos os canais|すべてのチャンネル|모든 채널
Channel {0}|通道 {0}|Canal {0}|Canal {0}|チャンネル {0}|채널 {0}
Unknown|未知|Desconocido|Desconhecido|不明|알 수 없음
Teal|青绿|Verde azulado|Verde-azulado|青緑|청록
Violet|紫罗兰|Violeta|Violeta|すみれ色|제비꽃색
Coral|珊瑚|Coral|Coral|コーラル|산호색
Amber|琥珀|Ámbar|Âmbar|琥珀色|호박색
As drawn|使用已绘制曲线|Según el trazado|Como desenhado|描画どおり|그린 곡선대로
Step|阶跃|Escalón|Degrau|ステップ|계단형
Bend early|前段弯曲|Curva temprana|Curva inicial|前半で変化|앞쪽 곡선
Bend late|后段弯曲|Curva tardía|Curva tardia|後半で変化|뒤쪽 곡선
Set at bar|在小节处设置|Aplicar al compás|Aplicar ao compasso|小節に設定|마디에 설정
Set point|设置节点|Fijar punto|Definir ponto|ポイントを設定|지점 설정
Set time signature at current bar|设置当前小节拍号|Fijar compás en el compás actual|Definir fórmula de compasso no compasso atual|現在の小節の拍子を設定|현재 마디의 박자표 설정
Set tempo at playhead|设置播放头处速度|Fijar tempo en el cursor|Definir andamento no cursor|再生ヘッド位置のテンポを設定|재생 헤드에서 템포 설정
New track folder|新建轨道文件夹|Nueva carpeta de pistas|Nova pasta de faixas|新規トラックフォルダー|새 트랙 폴더
Edit track folder|编辑轨道文件夹|Editar carpeta de pistas|Editar pasta de faixas|トラックフォルダーを編集|트랙 폴더 편집
Name|名称|Nombre|Nome|名前|이름
Parent folder|上级文件夹|Carpeta superior|Pasta superior|親フォルダー|상위 폴더
Folder color|文件夹颜色|Color de carpeta|Cor da pasta|フォルダーの色|폴더 색상
Tracks|轨道|Pistas|Faixas|トラック|트랙
Ungroup|取消分组|Desagrupar|Desagrupar|グループ解除|그룹 해제
Project root|工程根目录|Raíz del proyecto|Raiz do projeto|プロジェクトのルート|프로젝트 루트
Privacy|隐私|Privacidad|Privacidade|プライバシー|개인정보 보호
Imprint|法律声明|Aviso legal|Aviso legal|法的表示|법적 고지
`.trim()
