# 歯車の種類 参考画像集

3D ギアサンドボックスの設計用に、Wikimedia Commons から集めた参考画像です。
すべて自由ライセンス（CC0 / パブリックドメイン / CC BY / CC BY-SA）です。
CC BY・CC BY-SA の画像を再配布やアプリ内で使う場合は、作者名とライセンスを明記してください（BY-SA は改変物も同じライセンスで公開する必要があります）。

- 「見ていて楽しいか」「3D で手続き的に作る難しさ」は、ブラウザ（Three.js 等）での実装を想定した筆者の主観的な目安です（★が多いほど楽しい／難しい）。
- 大きな画像は Wikimedia が用意している縮小版（500px など）を取得しています。

---

## 1. 平歯車（Spur gear）

| ファイル | 出典 | ライセンス / 作者 |
|---|---|---|
| `01_spur_gears_animation.gif`（アニメ） | https://commons.wikimedia.org/wiki/File:Spur_gears_animation.gif | CC0 / Jahobr |
| `01_spur_two_gears_1to2.gif`（アニメ、1:2 の歯数比） | https://commons.wikimedia.org/wiki/File:Animated_two_spur_gears_1_2.gif | CC0 / Jahobr |

- **何をするもの？** 歯がまっすぐな、いちばん基本的な歯車です。2 枚をかみ合わせると互いに逆向きに回り、歯数の比で回転速度が変わります。
- **つなぐ軸:** 平行な 2 本の軸。
- **見ていて楽しいか:** ★★★☆☆ ― シンプルですが、大小の歯車がたくさん連なると十分楽しいです。
- **実装の難しさ:** ★☆☆☆☆ ― 2D の歯形（インボリュート曲線、または簡易的な台形でも可）を押し出すだけ。回転は「角速度 × 歯数比」で計算でき、最初に作るべき基本形です。

## 2. かさ歯車（Bevel gear）

| ファイル | 出典 | ライセンス / 作者 |
|---|---|---|
| `02_bevel_gear_photo.jpg`（写真、90°） | https://commons.wikimedia.org/wiki/File:Bevel_gear.jpg | CC BY-SA 3.0 / Audriusa（推定） |
| `02_bevel_gear_drawing.png`（線画） | https://commons.wikimedia.org/wiki/File:Gear_-_Bevel_(PSF).png | パブリックドメイン / Pearson Scott Foresman |
| `02_bevel_kegelrad.gif`（図解：左が 90°、右が 90° 以外の交差角） | https://commons.wikimedia.org/wiki/File:Kegelrad.gif | CC BY-SA 3.0 / Ralf Pfeifer（ドイツ語版 Wikipedia） |

- **何をするもの？** 円すい（コーン）の形をした歯車で、回転の向きを曲げて伝えます。車のデファレンシャルギアや手回しドリルなどで使われます。
- **つなぐ軸:** 交わる 2 本の軸（ふつうは 90°。`02_bevel_kegelrad.gif` の右図のように、90° 以外の角度にもできます。2 本の軸の延長線と、両方の円すいの頂点が 1 点 O で交わるのがポイントです）。
- **見ていて楽しいか:** ★★★★☆ ― 回転が「直角に曲がる」のは直感的に面白く、見栄えがします。
- **実装の難しさ:** ★★★☆☆ ― 歯を円すい面に沿って、外側ほど大きく内側ほど小さく作る必要があります。見た目だけなら「歯の断面を頂点に向かって縮めながら押し出す」近似で十分です。回転比は平歯車と同じく歯数比です。

## 3. ウォームギア（Worm gear：ウォーム＋ウォームホイール）

| ファイル | 出典 | ライセンス / 作者 |
|---|---|---|
| `03_worm_gear_animation.gif`（アニメ） | https://commons.wikimedia.org/wiki/File:Worm_Gear.gif | パブリックドメイン / User:Catsquisher |
| `03_worm_schnecke_animation.gif`（3D レンダーのアニメ） | https://commons.wikimedia.org/wiki/File:Schnecke10.gif | CC BY-SA 3.0 / Quant3 |
| `03_worm_gear_photo.jpg`（写真） | https://commons.wikimedia.org/wiki/File:Worm_Gear_and_Pinion.jpg | パブリックドメイン / Arthur Clarke（英語版 Wikipedia） |

- **何をするもの？** ねじ（ウォーム）を回すと、かみ合った歯車（ウォームホイール）がゆっくり回ります。ウォームが 1 回転してもホイールは歯 1 つ分しか進まないので、大きく減速できます。逆にホイール側から回すことはほぼできない（セルフロック）のも特徴です。
- **つなぐ軸:** 交わらず、ねじれた位置関係（ふつう 90°）の 2 本の軸。
- **見ていて楽しいか:** ★★★★★ ― ねじがクルクル回って、大きな歯車がじわじわ動く様子は非常に気持ちいいです。
- **実装の難しさ:** ★★★☆☆ ― ウォームはらせん（ヘリックス）状の山を作れば OK。ホイールは厳密には歯をくぼませる必要がありますが、見た目なら斜め歯の平歯車で十分ごまかせます。回転比は「ホイール歯数 ÷ ウォームの条数（ふつう 1）」。

## 4. ハスバ歯車（Helical gear）と ねじ歯車（Crossed helical gear）

| ファイル | 出典 | ライセンス / 作者 |
|---|---|---|
| `04_helical_animation_fr.gif`（アニメ、平行軸のハスバ歯車） | https://commons.wikimedia.org/wiki/File:Anim_engrenages_helicoidaux.gif | CC BY-SA 3.0 / user:Sador |
| `04_helical_gear_drawing.png`（線画、平行軸のハスバ歯車） | https://commons.wikimedia.org/wiki/File:Gear_-_Helical_(PSF).png | パブリックドメイン / Pearson Scott Foresman |
| `04_helical_gears_photo.jpg`（写真、メカノ製。特に下段が軸を 90° ずらした「ねじ歯車」としてのかみ合い） | https://commons.wikimedia.org/wiki/File:Helical_Gears.jpg | パブリックドメイン / Arthur Clarke（英語版 Wikipedia） |

- **何をするもの？**
  - **ハスバ歯車:** 歯が斜め（らせん状）に切られた歯車。平歯車より静かでなめらかに回るため、自動車の変速機などで多く使われます。
  - **ねじ歯車:** ハスバ歯車同士を、軸をねじった向きでかみ合わせたもの。ウォームギアに近い仲間ですが、減速比は小さめで、軽い力の伝達向きです。
- **つなぐ軸:** ハスバ歯車 = 平行な軸。ねじ歯車 = 交わらず、ねじれた位置の軸（よく使うのは 90°）。
- **見ていて楽しいか:** ★★★☆☆（ハスバ）／★★★★☆（ねじ歯車） ― 斜めの歯が流れるように見えてきれいです。ねじ歯車は「どうやってかみ合っているの？」という不思議さがあります。
- **実装の難しさ:** ★★☆☆☆ ― 平歯車の歯形を、押し出しながら少しずつ回転させる（ツイスト押し出し）だけで作れます。ねじ歯車は「ねじれ角の和 = 軸の交差角」になるように配置するのがポイントですが、見た目だけならそこまで厳密でなくても大丈夫です。
- **注意:** ねじ歯車の分かりやすいアニメ GIF は見つかりませんでした（写真のみ）。

## 5. 内歯車（Internal / ring gear）と 遊星歯車（Planetary gear）

| ファイル | 出典 | ライセンス / 作者 |
|---|---|---|
| `05_internal_gear_meshing.gif`（アニメ、内歯車と小歯車のかみ合い） | https://commons.wikimedia.org/wiki/File:Involute_Spur_Gears_Internal_Meshing.gif | CC BY 4.0 / M. D. Lebedev |
| `05_internal_gear.png`（内歯車の図） | https://commons.wikimedia.org/wiki/File:Internal_gear.svg | CC0 / Jahobr |
| `05_planetary_stationary_carrier.gif`（アニメ、遊星歯車・キャリア固定） | https://commons.wikimedia.org/wiki/File:Epicyclic_Gearing_Stationary_Carrier.gif | CC0 / Jahobr |
| `05_planetary_gear_animation.gif`（3D アニメ、遊星歯車） | https://commons.wikimedia.org/wiki/File:Planetary_Gear_Animation.gif | CC0 / Laserlicht |

- **何をするもの？**
  - **内歯車:** リングの内側に歯がある歯車。中の小さな歯車と同じ向きに回るのが平歯車との違いです。
  - **遊星歯車:** 中心の「太陽歯車」、その周りを回る複数の「遊星歯車」、外側の「内歯車（リング）」、遊星をつなぐ「キャリア」でできた装置。どれを固定するかで減速・増速・逆転が切り替わり、コンパクトに大きな減速ができます（自動車の AT、電動ドライバーなど）。
- **つなぐ軸:** 同じ一直線上の軸（同軸）。遊星歯車自身の軸はキャリアと一緒に公転します。
- **見ていて楽しいか:** ★★★★★ ― 遊星が自転しながら公転する動きは、全種類の中でいちばん見ていて楽しいと思います。サンドボックスの目玉候補です。
- **実装の難しさ:** ★★★☆☆ ― 形状は平歯車の応用（内歯車は歯形を反転するだけ）なので簡単ですが、回転の計算が少し複雑です（ウィリスの式：(ω太陽 − ωキャリア) / (ωリング − ωキャリア) = −Zリング / Z太陽）。また、歯数の組み合わせに制約があります（Zリング = Z太陽 + 2 × Z遊星、等間隔配置には (Z太陽 + Zリング) ÷ 遊星の数 が整数）。

## 6. ラック＆ピニオン（Rack and pinion）

| ファイル | 出典 | ライセンス / 作者 |
|---|---|---|
| `06_rack_and_pinion_animated.gif`（アニメ） | https://commons.wikimedia.org/wiki/File:Animated_rack_and_pinion.gif | CC0 / Jahobr |
| `06_rack_and_pinion_osha.gif`（小さいアニメ） | https://commons.wikimedia.org/wiki/File:Rack_and_pinion_animation.gif | パブリックドメイン / 米国 OSHA |

- **何をするもの？** 丸い歯車（ピニオン）と、まっすぐな棒状の歯車（ラック）の組み合わせ。回転運動を直線運動に（またはその逆に）変えます。車のハンドル（ステアリング）や登山鉄道で使われます。
- **つなぐ軸:** 回転軸 ↔ 直線の動き（ラックは「半径が無限大の歯車」と考えられます）。
- **見ていて楽しいか:** ★★★★☆ ― 回転が直線になる変化が分かりやすく、何かを押したり持ち上げたりする仕掛けに使うと楽しいです。
- **実装の難しさ:** ★★☆☆☆ ― ラックは台形の歯を並べて押し出すだけ。移動量 = ピニオンの回転角 × ピッチ円半径。ただしラックには端があるので、端に来たら止める／往復させる処理が必要です。

## 7. チェーン＆スプロケット、ベルト＆プーリー

| ファイル | 出典 | ライセンス / 作者 |
|---|---|---|
| `07_chain_sprocket_osha.gif`（小さいアニメ、チェーンとスプロケット） | https://commons.wikimedia.org/wiki/File:Chain.gif | パブリックドメイン / 米国 OSHA |
| `07_sprocket_drawing.png`（スプロケットの図面） | https://commons.wikimedia.org/wiki/File:Sprocket16.png | CC BY-SA 3.0 / Hiro36（日本語版 Wikipedia） |
| `07_roller_chain_render.png`（ローラーチェーンの 3D レンダー） | https://commons.wikimedia.org/wiki/File:Roller_Chain_Render_(with_numbers).png | CC BY-SA 3.0 / Niabot |
| `07_belt_pulley_osha.gif`（小さいアニメ、ベルトとプーリー） | https://commons.wikimedia.org/wiki/File:Power_transmission_belt.gif | パブリックドメイン / 米国 OSHA |
| `07_belt_pulleys_diagram.png`（ベルト伝動の図） | https://commons.wikimedia.org/wiki/File:Belt_pulleys.svg | CC0 / Pradana Aumars |
| `07_v_belt_drive_photo.jpg`（V ベルト伝動の写真） | https://commons.wikimedia.org/wiki/File:Multiple-V-belt_drive_001.jpg | CC BY-SA 3.0 / Three-quarter-ten |

- **何をするもの？**
  - **チェーン＆スプロケット:** 自転車と同じ仕組み。歯の付いた円盤（スプロケット）にチェーンを掛けて、離れた軸に回転を伝えます。すべらないので回転比が正確です。
  - **ベルト＆プーリー:** 溝付きの車（プーリー）にゴムなどのベルトを掛けて回転を伝えます。静かで、過負荷のときは滑って機械を守れます。ベルトを 8 の字にクロスさせると逆回転にもできます。
- **つなぐ軸:** 離れた位置にある平行な軸（両方とも同じ向きに回ります）。
- **見ていて楽しいか:** ★★★★★（チェーン）／★★★☆☆（ベルト） ― チェーンのコマがスプロケットに巻き付いていく動きは非常に気持ちいいです。ベルトは無地だと動きが見えにくいので、模様やマークを付けると良いです。
- **実装の難しさ:** ★★★★☆（チェーン）／★★☆☆☆（ベルト） ― ベルトは「2 つの円の共通接線 + 円弧」の経路を作り、テクスチャをスクロールさせるだけでそれらしく見えます。チェーンは同じ経路に沿ってコマ（リンク）を 1 個ずつ配置し、毎フレーム経路上を移動させる必要があり、コマ数やスプロケット間の距離の調整（コマの長さの整数倍にする）が少し面倒です。3 つ以上のスプロケットやテンショナーを入れると経路計算はさらに難しくなります。

---

## まとめ：おすすめ実装順（主観）

1. 平歯車（基本。ここで歯形生成と回転伝達の仕組みを作る）
2. ラック＆ピニオン、内歯車（平歯車の応用ですぐできる）
3. 遊星歯車（見た目のインパクト大、計算も平歯車の延長）
4. ハスバ歯車 → ねじ歯車（ツイスト押し出し）
5. かさ歯車、ウォームギア（3D 的な軸配置が必要になる）
6. ベルト → チェーン（経路計算が必要）
