# Kemahiran

Kemahiran ialah satu set arahan kerja untuk AI. Tulis sekali sahaja perkara yang anda lakukan berulang kali — langkah mengemas nota mesyuarat, nada sesebuah laporan, perkara yang perlu disemak setiap kali — dan anda boleh memanggilnya dalam panel AI, atau AI akan menggunakannya sendiri apabila sesuai. Kemahiran ialah folder yang mengandungi fail `SKILL.md` dalam format terbuka, jadi kemahiran yang dibuat dalam GenOffice juga boleh digunakan terus dalam Claude Code atau Codex.

## Menghidupkan dan mematikan kemahiran

**Tetapan ▸ Kemahiran** menyenaraikan kemahiran pada PC ini, dikumpulkan mengikut asalnya. Setiap kemahiran dipaparkan dengan namanya, seperti dalam ejen pengekodan. Gunakan kotak carian di bahagian atas untuk mencari mengikut nama atau keterangan.

| Sumber                      | Kandungannya                                                  | Pada mulanya |
| --------------------------- | ------------------------------------------------------------- | ------------ |
| **Terbina dalam**           | 5 kemahiran yang disertakan bersama GenOffice                 | Hidup        |
| **Kemahiran saya**          | Kemahiran yang anda tambah atau buat (`~/.ieumoffice/skills`) | Hidup        |
| **Folder kemahiran Claude** | Kemahiran dalam `~/.claude/skills`                            | Mati         |
| **Pemalam Claude**          | Kemahiran daripada pemalam Claude yang dipasang               | Mati         |
| **Folder kemahiran Codex**  | Kemahiran dalam `~/.agents/skills`                            | Mati         |

- Suis menghidupkan atau mematikan kemahiran. Tetapan yang sama terpakai pada panel AI setiap editor, Tanya AI di Laman Utama dan tetingkap ejen.
- Bagi kemahiran yang hidup, pilih **AI tentukan** atau **Hanya apabila dipanggil**. Pada mulanya ia ditetapkan kepada AI tentukan. Dengan Hanya apabila dipanggil, kemahiran itu digunakan hanya apabila anda sendiri memanggilnya.
- Kemahiran daripada sumber yang berlainan boleh mempunyai nama yang sama. Label sumber pada setiap baris membezakannya.
- Menu lagi mengandungi **Lihat kandungan**, **Sunting** (kemahiran saya sahaja), **Eksport (zip)** (kemahiran saya sahaja) dan **Buka folder**.
- **Alih ke tong sampah** memindahkan salah satu kemahiran saya ke tong sampah sistem, dan anda boleh memulihkannya dari situ.
- Kemahiran terbina dalam tidak dibuang tetapi disembunyikan: pilih **Sembunyikan**. **Tunjukkan semula** di bahagian bawah senarai mengembalikannya seperti keadaan asal.
- Untuk mengubah kemahiran terbina dalam atau kemahiran daripada program lain, pilih **Salin ke kemahiran saya**. Salinannya muncul dalam kemahiran saya dan kemahiran asal dimatikan.
- Apabila kemahiran yang mempunyai templat dieksport, dokumen templat turut dimasukkan ke dalam fail zip. Pastikan dokumen itu tidak mengandungi maklumat peribadi sebelum anda mengeksportnya.
- **Eksport beberapa** di bahagian atas halaman memasukkan kemahiran yang anda tandakan ke dalam satu fail zip, satu folder bagi setiap kemahiran. Penerima zip itu menambahkannya dengan cara yang sama seperti zip kemahiran lain, dan boleh memilih kemahiran mana di dalamnya untuk dipasang.

## Menambah kemahiran

1. Dalam **Tetapan ▸ Kemahiran**, klik **Tambah**.
2. Pilih **Daripada folder**, **Daripada fail zip**, **Daripada teks yang ditampal** atau **Daripada pautan GitHub**. Untuk teks yang ditampal, tampal keseluruhan `SKILL.md` bermula dari baris `---` pertamanya, kemudian klik **Pratonton**. Untuk GitHub, masukkan alamat repositori awam, `owner/repo` atau halaman kemahiran di skills.sh, kemudian klik **Cari**.
3. Semak kemahiran yang ditemui dalam pratonton. Pratonton menunjukkan bilangan dan saiz fail, sama ada terdapat skrip, alamat web dalam teks, fail lesen dan baris yang patut dibaca sebelum memasang.
4. Tandakan hanya kemahiran yang hendak dipasang, kemudian klik **Pasang**. Kemahiran yang dipasang bermula dalam keadaan hidup.

Di bawah pratonton sentiasa tertulis: "Pasang kemahiran hanya daripada sumber yang anda percayai. Kemahiran memberi arahan kepada AI, dan dalam tetingkap ejen ia boleh menjalankan skrip." Baca dahulu kemahiran daripada sumber yang tidak dikenali sebelum memasangnya.

- Jika kemahiran saya sudah ada kemahiran dengan nama yang sama, pilih **Gantikan** atau **Langkau** pada baris itu.
- Anda juga boleh melepaskan fail zip kemahiran atau fail `SKILL.md` pada mana-mana tetingkap GenOffice. **Tetapan ▸ Kemahiran** dibuka dengan pratonton yang sama. Zip dikira sebagai kemahiran apabila `SKILL.md` berada di peringkat teratasnya atau setiap folder teratas mengandungi satu; zip lain dibiarkan. Fail `SKILL.md` masuk bersendirian: masukkan kemahiran yang mempunyai fail lain ke dalam zip.
- **Baris yang patut dibaca sebelum memasang** ialah baris yang meminta AI mengabaikan arahan sebelumnya, menyembunyikan sesuatu daripada anda atau mengambil arahan dari alamat luar, serta laluan `../` yang menghala ke luar folder kemahiran. Setiap satu menunjukkan fail dan barisnya. Baris ini tidak menghalang pemasangan, dan kemahiran tanpa baris sebegini tidak semestinya selamat.
- Semasa memuat turun dari GitHub, GenOffice hanya bersambung ke `github.com`, `api.github.com` dan `codeload.github.com`, dan tidak menghantar sebarang data log masuk. Jika arkib terlalu besar atau gagal dalam semakan keselamatan, tiada apa-apa yang dipasang.
- Halaman kemahiran di skills.sh (`https://skills.sh/owner/repo/skill`) dibaca sebagai kemahiran itu dalam repositori GitHub `owner/repo`. GenOffice tidak bersambung ke skills.sh.
- **Kemahiran baharu** membuka editor kosong untuk anda menulis sendiri nama, keterangan dan arahannya.

## Menyemak kemas kini

- Bagi kemahiran yang dipasang dari GitHub, **Semak kemas kini** dalam menu lagi mencari kandungan baharu. GitHub dihubungi hanya apabila anda mengkliknya.
- Jika tiada perubahan, ia memaparkan "Terkini". Jika ada, semak fail yang berubah dan pratontonnya, kemudian klik **Kemas kini**.
- Jika anda sendiri telah menyunting kemahiran itu selepas memasangnya, "Suntingan anda sendiri akan hilang" turut dipaparkan.
- Kemas kini mengekalkan keadaan hidup/mati kemahiran itu serta pilihan AI tentukan / Hanya apabila dipanggil.

## Memanggil kemahiran dalam panel AI

1. Taip `/` atau `$` di awal kotak input AI atau sejurus selepas ruang kosong. Senarai kemahiran yang hidup akan muncul.
2. Teruskan menaip untuk mengecilkan senarai. Contohnya, `/meet` menemui `meeting-minutes`. Perkataan dalam keterangan juga boleh digunakan, jadi `/minit` juga menemuinya.
3. Pilih satu dengan kekunci anak panah dan tekan Enter atau Tab. Kemahiran itu menjadi cip di atas kotak input.
4. Tulis apa yang anda mahu dan hantar. GenOffice menambah kandungan kemahiran itu pada permintaan.

- Dalam panel AI Excel, `$` membuka senarai hanya di awal kotak input, supaya tidak mengganggu alamat sel seperti `$A$1`.
- Anda boleh menambah beberapa cip dan membuang salah satu dengan ×. Esc hanya menutup senarai; ia tidak menghentikan AI yang sedang berjalan.
- **Urus kemahiran…** di bahagian bawah senarai membuka **Tetapan ▸ Kemahiran**.
- Cip kekal pada mesej yang anda hantar dan dalam perbualan yang disimpan. Apabila anda membuka semula perbualan dan menghantar lagi, kandungan semasa kemahiran itu dibaca semula. Kemahiran yang telah dibuang atau dimatikan sementara itu ditandakan "Tiada" pada cipnya.
- Jika teks kemahiran yang dihantar bersama terlalu panjang, "Kemahiran terlalu besar untuk dihantar bersama" dipaparkan dan tiada apa-apa dihantar.

## Kemahiran yang digunakan AI sendiri

- Bagi kemahiran yang hidup dan ditetapkan kepada AI tentukan, nama dan keterangannya diberikan kepada AI dalam bentuk senarai. Apabila salah satunya sesuai dengan permintaan, AI mengambil kandungannya dan menggunakannya.
- Apabila AI menggunakan sesuatu kemahiran, perbualan memaparkan "Menggunakan kemahiran 〈nama〉".
- AI memutuskan berdasarkan keterangan sama ada hendak menggunakan sesuatu kemahiran. Keterangan yang menyatakan bila kemahiran itu patut digunakan membantu AI memilih dengan tepat.

## Membuat kemahiran dengan meminta

1. Dalam panel AI, sebut sesuatu seperti "Simpan apa yang kita buat tadi sebagai kemahiran" atau "Buat kemahiran yang menulis laporan mengikut gaya organisasi kita".
2. AI memilih langkah dan peraturan yang wajar diulang, lalu memaparkan kad **Kemahiran baharu**. Nilai yang digunakan sekali ini sahaja, seperti nama dan tarikh, tidak dimasukkan ke dalam arahan.
3. Semak dan sunting nama, keterangan dan arahan pada kad. Nama ialah yang dipaparkan dalam senarai kemahiran dan yang anda taip selepas `/`: huruf kecil bahasa Inggeris, digit dan tanda sempang.
4. Klik **Simpan**. Kemahiran baharu ditambah ke kemahiran saya dalam keadaan hidup, dan terus muncul dalam senarai `/`.

- Tiada fail ditulis sehingga anda mengklik **Simpan**. Jika anda mengklik **Batal**, perbualan hanya menyimpannya sebagai "Cadangan kemahiran yang tidak disimpan".
- Anda juga boleh meminta supaya kemahiran sedia ada diubah, contohnya "Ubah kemahiran minit mesyuarat mengikut cara kita bekerja". Kad itu kemudian bertajuk **Ubah kemahiran**. Kemahiran saya ditulis ganti dengan **Ganti**; kemahiran terbina dalam atau kemahiran daripada program lain disimpan sebagai salinan dalam kemahiran saya dan kemahiran asal dimatikan.

## Memilih tempat kemahiran digunakan

Kemahiran yang hanya sesuai untuk satu jenis dokumen, seperti menggayakan slaid atau mengemaskan hamparan, boleh dipaparkan dalam panel AI editor itu sahaja. Dalam editor lain, senarai `/` dan senarai kemahiran yang digunakan AI sendiri menjadi lebih pendek, jadi AI lebih kerap memilih kemahiran yang betul.

- Untuk kemahiran saya, buka **Sunting** dan pilih **Semua editor** atau **Editor ini sahaja** di **Tempat digunakan**. Editor yang dipilih ditulis dalam fail kemahiran, jadi ia ikut sama apabila kemahiran dieksport atau dibawa ke program lain.
- Untuk kemahiran terbina dalam atau kemahiran program lain, tukar di **Tempat digunakan** dalam **Lihat kandungan**. Pilihan ini disimpan dalam tetapan PC ini sahaja; fail kemahiran tidak berubah.
- Kemahiran yang tidak digunakan dalam semua editor menyatakannya pada barisnya, contohnya "Digunakan dalam: Persembahan".
- Apabila AI membuat kemahiran yang hanya sesuai untuk satu format, AI turut mencadangkan tempat ia digunakan; jika tidak, ia dibiarkan untuk semua editor. Anda boleh menukarnya di **Tempat digunakan** pada kad sebelum menyimpan.
- Tanya AI di Laman Utama dan tetingkap ejen menggunakan semua kemahiran yang dihidupkan, di mana pun ia ditetapkan untuk digunakan.

## Menambah dokumen sebagai templat

Apabila anda membuat kemahiran dalam panel AI sesebuah editor, dokumen semasa boleh disertakan sebagai templat. Tandakan **Simpan juga dokumen ini sebagai templat** pada kad, dan butang itu menjadi dua.

- **Buat templat kosong**: salinan dokumen dibuka dalam tab baharu, "Pratonton templat - 〈tajuk〉", dan AI dalam tab itu mengosongkan nilai yang telah diisi seperti nama, tarikh dan maklumat peribadi. Semak tab itu, ubah lagi secara manual jika perlu, kemudian klik **Simpan tab ini sebagai templat**; keadaan tab pada saat itu menjadi templat.
- **Simpan dokumen seadanya**: menyimpan dokumen semasa sebagai templat tanpa sebarang perubahan. Jika dokumen mempunyai bahagian yang anda sembunyikan daripada AI, butang ini disekat supaya kandungan tersembunyi tidak masuk ke dalam templat begitu sahaja.
- Templat disimpan sebagai salinan dokumen di dalam folder kemahiran. Dokumen asal tidak berubah.

## Menggunakan kemahiran yang mempunyai templat

- Kemahiran yang mempunyai templat ditandakan **Ada templat** dalam senarai.
- Panggil kemahiran itu sebagai cip dan hantar, lalu salinan templat dibuka sebagai dokumen baharu tanpa tajuk; AI dalam tab itu meneruskan permintaan anda. Panel asal memaparkan "Kerja dengan templat diteruskan dalam tab baharu" dan **Pergi ke tab**.
- Apabila AI sendiri memilih kemahiran bertemplat, tiada tab dibuka serta-merta. Sebaliknya, perbualan memaparkan butang **Buka dokumen baharu daripada templat ini**.
- Jika dipanggil dalam dokumen yang sudah ada kandungan, ia bertanya di mana hendak bekerja dan tidak terus membuka tab. **Buat dalam dokumen ini** mengubah dokumen semasa mengikut kemahiran tanpa tab baharu (fail templat tidak dibuka). **Dokumen baharu daripada templat (lampirkan dokumen ini)** membuka salinan templat dalam tab baharu dan menghantar dokumen semasa kepada panel AI tab itu sebagai lampiran. Untuk melampirkannya, dokumen semasa mesti sudah disimpan. Jika ia tidak pernah disimpan atau ada perubahan yang belum disimpan, panel memberitahu, dan **Buka tanpa melampirkan** membuka salinan tanpanya. Butang yang muncul apabila AI sendiri menggunakan kemahiran bertemplat juga melampirkan dokumen yang ada kandungan. Editor Markdown dan PDF tidak menerima lampiran, jadi templat yang dibuka di sana tidak dilampirkan apa-apa.
- Biasanya anda memilih lokasi dokumen baharu itu pada kali pertama anda menyimpannya. Editor Markdown dan HTML menyimpan ke folder lalai seperti biasa. Fail templat itu sendiri kekal seperti asal.

## Kemahiran yang mempunyai skrip

- Dalam panel AI biasa dan dalam Tanya AI di Laman Utama, skrip sesuatu kemahiran tidak pernah dijalankan. Hanya teks kemahiran itu yang sampai kepada AI.
- Kemahiran yang mempunyai skrip ditandakan **Ada skrip · berfungsi sepenuhnya dalam tetingkap ejen**, dan apabila ditambah sebagai cip, "Skrip kemahiran ini tidak dijalankan dalam panel AI biasa" dipaparkan. Penghantaran tidak disekat.
- Untuk turut menggunakan skripnya, panggil kemahiran itu dalam tetingkap ejen. Lihat [Mod ejen](help://agent-mode).

## Kemahiran terbina dalam

| Kemahiran         | Fungsinya                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `meeting-minutes` | Menyusun nota mesyuarat menjadi minit yang menunjukkan keputusan dan tindakan susulan    |
| `internal-comms`  | Menulis pengumuman, buletin, laporan kemajuan, soalan lazim dan mesej dalaman lain       |
| `humanizer`       | Mencari ungkapan yang berbunyi seperti ditulis AI dan menjadikannya semula jadi          |
| `copy-editing`    | Menyemak teks bahasa Inggeris yang anda tulis supaya lebih jelas dan ringkas             |
| `find-skills`     | Mencari kemahiran yang anda perlukan dalam tetingkap ejen dan mencadangkan pemasangannya |

`copy-editing` dibuat untuk teks pemasaran bahasa Inggeris. `find-skills` hanya berfungsi dalam tetingkap ejen.

## Dalam tetingkap ejen

- Tetingkap ejen mengikut tetapan hidup/mati yang sama dalam **Tetapan ▸ Kemahiran**, dan anda memanggil kemahiran dalam kotak inputnya dengan `/` atau `$` dengan cara yang sama.
- Kemahiran dalam `.claude/skills` dan `.agents/skills` folder projek digunakan dalam sesi itu tanpa perlu dihidupkan.
- Senarai kemahiran ditetapkan apabila sesi bermula. Jika anda menghidupkan atau mematikan kemahiran semasa sesi, "Kemahiran yang diubah berkuat kuasa mulai sesi seterusnya" dipaparkan.
- Apabila ejen membuat kemahiran, kad yang sama muncul dalam tetingkap. Untuk templat, pilih antara dokumen yang dibuka dalam tab dan fail dalam folder projek.
- Apabila ejen menemui kemahiran yang wajar dipasang, cadangan pemasangan dipaparkan. Bukanya dengan **Buka pratonton** dan klik sendiri **Pasang**; jika tidak, tiada apa-apa yang dipasang. Kemahiran yang dipasang tersedia mulai sesi seterusnya.
