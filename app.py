import sys
import requests
from bs4 import BeautifulSoup
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
                             QLineEdit, QPushButton, QListWidget, QFileDialog, QSpinBox, QLabel, QCheckBox,
                             QTabWidget, QTableWidget, QTableWidgetItem, QMessageBox)
from PyQt5.QtCore import Qt, QThread, pyqtSignal
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import re
from datetime import datetime
import sqlite3
import redis
import hashlib

class ScraperThread(QThread):
    result_signal = pyqtSignal(list)
    error_signal = pyqtSignal(str)
    title_signal = pyqtSignal(str)
    user_signal = pyqtSignal(str)
    progress_signal = pyqtSignal(str)

    def __init__(self, url, min_size):
        super().__init__()
        self.url = url
        self.min_size = min_size * 1024

    def run(self):
        try:
            session = requests.Session()
            session.headers.update({'User-Agent': 'Mozilla/5.0'})
            image_urls = []

            # Acessar página da galeria para encontrar o link do tape
            response = session.get(self.url, timeout=5)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')

            # Encontrar link do tape usando padrão no href
            tape_link = soup.find('a', href=re.compile(r'/[^/]+/tape-\d+-\d+-0\.html\?pwd='))
            if not tape_link:
                self.error_signal.emit(f"Link do tape não encontrado na página da galeria: {self.url}")
                return
            tape_url = tape_link['href']
            if tape_url.startswith('/'):
                tape_url = f"https://imgsrc.ru{tape_url}"
            elif not tape_url.startswith('http'):
                tape_url = f"https://imgsrc.ru/{tape_url}"
            self.progress_signal.emit(f"Link do tape encontrado: {tape_url}")

            # Acessar página do tape para extrair usuário e título
            response = session.get(tape_url, timeout=5)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')

            # Extrair nome do usuário da URL do tape
            user_match = re.match(r'https://imgsrc\.ru/([^/]+)/', tape_url)
            user_name = user_match.group(1) if user_match else "unknown_user"
            self.user_signal.emit(user_name)

            # Extrair título da página do tape
            title_tag = soup.find('title')
            page_title = title_tag.text.split(' @')[0] if title_tag else ""
            page_title = re.sub(r'[^\w\s-]', '', page_title).strip()
            page_title = re.sub(r'\s+', '_', page_title).rstrip('_')
            page_title = re.sub(r'_+', '_', page_title)
            if not page_title:
                page_title = f"album_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            self.title_signal.emit(page_title)
            self.progress_signal.emit(f"Título da subpasta: {page_title}")

            # Extrair URLs das páginas do tape
            page_urls = [tape_url]
            page_links = soup.find_all('a', href=re.compile(r'tape-.*\.html\?pwd=$'))
            for link in page_links:
                page_url = link['href']
                if page_url.startswith('/'):
                    page_url = f"https://imgsrc.ru{page_url}"
                if page_url not in page_urls:
                    page_urls.append(page_url)

            # Raspar cada página
            for i, current_url in enumerate(page_urls, 1):
                self.progress_signal.emit(f"Buscando página {i} ({current_url})...")
                try:
                    response = session.get(current_url, timeout=5)
                    response.raise_for_status()
                    soup = BeautifulSoup(response.text, 'html.parser')

                    source_tags = soup.find_all('source', srcset=True)
                    img_tags = soup.find_all('img', src=True)
                    for tag in source_tags + img_tags:
                        img_url = tag.get('srcset') or tag.get('src')
                        if not img_url.lower().endswith(('.gif', '.webp', '.jpg', '.jpeg')):
                            continue
                        if img_url.startswith('//'):
                            img_url = f"https:{img_url}"
                        elif not img_url.startswith('http'):
                            img_url = f"https://imgsrc.ru{img_url}"
                        try:
                            img_response = session.head(img_url, allow_redirects=True, timeout=3)
                            size = int(img_response.headers.get('content-length', 0))
                            if size >= self.min_size:
                                image_urls.append((img_url, size))
                        except requests.RequestException:
                            continue
                except requests.RequestException:
                    self.progress_signal.emit(f"Erro na página {i}, continuando...")
                    continue

            self.result_signal.emit(image_urls)
        except requests.RequestException as e:
            self.error_signal.emit(f"Erro ao acessar URL: {e}")

class ImageScraper(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Image Scraper")
        self.setGeometry(100, 100, 800, 500)
        self.image_urls = []
        self.page_title = "album"
        self.user_name = "unknown_user"
        self.downloaded_urls_set = set()
        self.init_db()
        self.init_redis()
        self.load_cache()
        self.init_ui()

    def init_db(self):
        self.conn = sqlite3.connect('downloads.db', check_same_thread=False)
        self.cursor = self.conn.cursor()
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS downloads (
                id INTEGER PRIMARY KEY,
                filename TEXT,
                user TEXT,
                url TEXT UNIQUE,
                url_hash TEXT,
                download_date TEXT,
                path TEXT,
                status TEXT
            )
        ''')
        self.cursor.execute('CREATE INDEX IF NOT EXISTS idx_url_hash ON downloads(url_hash)')
        self.conn.commit()

    def init_redis(self):
        try:
            self.redis_client = redis.Redis(host='localhost', port=6379, db=0)
            self.redis_client.ping()
        except redis.ConnectionError:
            self.redis_client = None
            print("Redis não disponível, usando apenas SQLite.")

    def load_cache(self):
        self.downloaded_urls_set = set()
        try:
            self.cursor.execute('SELECT url_hash FROM downloads WHERE status="active"')
            for row in self.cursor.fetchall():
                self.downloaded_urls_set.add(row[0])
        except sqlite3.Error as e:
            print(f"Erro ao carregar cache do SQLite: {e}")

    def sync_folders(self):
        try:
            self.cursor.execute('SELECT url, path FROM downloads WHERE status="active"')
            for url, path in self.cursor.fetchall():
                if not os.path.exists(path):
                    url_hash = hashlib.md5(url.encode()).hexdigest()
                    self.cursor.execute('UPDATE downloads SET status="deleted" WHERE url_hash=?', (url_hash,))
                    if self.redis_client:
                        self.redis_client.srem('downloaded_urls', url_hash)
            self.conn.commit()
            self.load_cache()
        except sqlite3.Error as e:
            self.result_list.addItem(f"Erro ao sincronizar pastas: {e}")

    def clear_history(self):
        reply = QMessageBox.question(self, 'Limpar Histórico', 'Deseja limpar todo o histórico de downloads?',
                                    QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
        if reply == QMessageBox.Yes:
            try:
                self.cursor.execute('DELETE FROM downloads')
                self.conn.commit()
                if self.redis_client:
                    self.redis_client.flushdb()
                self.downloaded_urls_set.clear()
                self.result_list.addItem("Histórico limpo com sucesso.")
                self.update_history_view()
            except sqlite3.Error as e:
                self.result_list.addItem(f"Erro ao limpar histórico: {e}")

    def export_history(self):
        file_path, _ = QFileDialog.getSaveFileName(self, "Salvar Histórico", "", "CSV Files (*.csv)")
        if file_path:
            try:
                self.cursor.execute('SELECT filename, user, url, download_date, path, status FROM downloads')
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write('filename,user,url,download_date,path,status\n')
                    for row in self.cursor.fetchall():
                        f.write(','.join(str(x).replace(',', '') for x in row) + '\n')
                self.result_list.addItem(f"Histórico exportado para: {file_path}")
            except (sqlite3.Error, OSError) as e:
                self.result_list.addItem(f"Erro ao exportar histórico: {e}")

    def init_ui(self):
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QVBoxLayout(main_widget)

        # Abas
        self.tabs = QTabWidget()
        layout.addWidget(self.tabs)

        # Aba principal
        main_tab = QWidget()
        main_layout = QVBoxLayout(main_tab)

        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("Digite URLs de galerias (ex.: https://imgsrc.ru/.../84647553.html, separadas por vírgula)")
        main_layout.addWidget(self.url_input)

        size_layout = QHBoxLayout()
        size_layout.addWidget(QLabel("Tamanho mínimo (KB):"))
        self.size_input = QSpinBox()
        self.size_input.setValue(10)
        self.size_input.setRange(1, 10000)
        size_layout.addWidget(self.size_input)
        main_layout.addLayout(size_layout)

        conn_layout = QHBoxLayout()
        conn_layout.addWidget(QLabel("Conexões simultâneas:"))
        self.conn_input = QSpinBox()
        self.conn_input.setValue(5)
        self.conn_input.setRange(1, 20)
        conn_layout.addWidget(self.conn_input)
        main_layout.addLayout(conn_layout)

        self.user_folder_check = QCheckBox("Criar pasta de usuário")
        self.user_folder_check.setChecked(False)
        main_layout.addWidget(self.user_folder_check)

        self.subfolder_check = QCheckBox("Criar subpasta com título do álbum")
        self.subfolder_check.setChecked(True)
        main_layout.addWidget(self.subfolder_check)

        self.overwrite_check = QCheckBox("Sobrescrever imagens existentes")
        self.overwrite_check.setChecked(False)
        main_layout.addWidget(self.overwrite_check)

        self.search_btn = QPushButton("Search")
        self.search_btn.clicked.connect(self.search_images)
        main_layout.addWidget(self.search_btn)

        self.one_click_btn = QPushButton("One Click!")
        self.one_click_btn.clicked.connect(self.one_click)
        main_layout.addWidget(self.one_click_btn)

        self.result_list = QListWidget()
        main_layout.addWidget(self.result_list)

        folder_layout = QHBoxLayout()
        self.folder_input = QLineEdit()
        self.folder_input.setPlaceholderText("Selecione a pasta de destino")
        folder_layout.addWidget(self.folder_input)
        self.folder_btn = QPushButton("Browse")
        self.folder_btn.clicked.connect(self.select_folder)
        folder_layout.addWidget(self.folder_btn)
        main_layout.addLayout(folder_layout)

        self.download_btn = QPushButton("Download")
        self.download_btn.clicked.connect(self.download_images)
        main_layout.addWidget(self.download_btn)

        self.tabs.addTab(main_tab, "Busca e Download")

        # Aba de histórico
        history_tab = QWidget()
        history_layout = QVBoxLayout(history_tab)

        self.history_table = QTableWidget()
        self.history_table.setColumnCount(6)
        self.history_table.setHorizontalHeaderLabels(['Filename', 'User', 'URL', 'Download Date', 'Path', 'Status'])
        self.history_table.setSortingEnabled(True)
        history_layout.addWidget(self.history_table)

        history_btn_layout = QHBoxLayout()
        self.clear_btn = QPushButton("Limpar Histórico")
        self.clear_btn.clicked.connect(self.clear_history)
        history_btn_layout.addWidget(self.clear_btn)

        self.export_btn = QPushButton("Exportar Histórico")
        self.export_btn.clicked.connect(self.export_history)
        history_btn_layout.addWidget(self.export_btn)
        history_layout.addLayout(history_btn_layout)

        self.tabs.addTab(history_tab, "Histórico de Downloads")
        self.update_history_view()

    def search_images(self):
        self.result_list.clear()
        self.image_urls = []
        urls_input = self.url_input.text().strip()
        if not urls_input:
            self.result_list.addItem("Digite pelo menos uma URL válida!")
            return

        self.search_btn.setEnabled(False)
        self.one_click_btn.setEnabled(False)
        self.result_list.addItem("Iniciando busca de imagens (.webp, .gif)...")
        self.sync_folders()

        # Separar URLs por vírgula
        urls = [url.strip() for url in urls_input.split(',') if url.strip()]
        if not urls:
            self.result_list.addItem("Nenhuma URL válida fornecida!")
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)
            return

        # Processar cada URL
        for url in urls:
            self.result_list.addItem(f"Processando galeria: {url}")
            thread = ScraperThread(url, self.size_input.value())
            thread.result_signal.connect(lambda image_urls, u=url: self.display_results(image_urls, u))
            thread.error_signal.connect(self.display_error)
            thread.title_signal.connect(lambda title, u=url: self.set_page_title(title, u))
            thread.user_signal.connect(lambda user, u=url: self.set_user_name(user, u))
            thread.progress_signal.connect(self.result_list.addItem)
            thread.finished.connect(self.search_finished)
            thread.start()
            # Armazenar thread para evitar garbage collection
            if not hasattr(self, 'threads'):
                self.threads = []
            self.threads.append(thread)

    def set_page_title(self, title, url):
        # Armazenar título por URL
        if not hasattr(self, 'titles'):
            self.titles = {}
        self.titles[url] = title
        self.page_title = title  # Para compatibilidade com download

    def set_user_name(self, user, url):
        # Armazenar usuário por URL
        if not hasattr(self, 'users'):
            self.users = {}
        self.users[url] = user
        self.user_name = user  # Para compatibilidade com download

    def display_results(self, image_urls, url):
        # Armazenar URLs de imagens por galeria
        if not hasattr(self, 'image_urls_dict'):
            self.image_urls_dict = {}
        self.image_urls_dict[url] = [img_url for img_url, _ in image_urls]
        self.image_urls.extend([img_url for img_url, _ in image_urls])
        for img_url, size in image_urls:
            self.result_list.addItem(f"{url}: {img_url} ({size // 1024} KB)")

    def display_error(self, error_msg):
        self.result_list.addItem(error_msg)

    def search_finished(self):
        # Verificar se todas as threads terminaram
        if hasattr(self, 'threads'):
            self.threads = [t for t in self.threads if t.isRunning()]
            if not self.threads:
                self.search_btn.setEnabled(True)
                self.one_click_btn.setEnabled(True)
                if not self.image_urls:
                    self.result_list.addItem("Nenhuma imagem .webp ou .gif encontrada!")
                del self.threads

    def select_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Selecione a pasta de destino")
        if folder:
            self.folder_input.setText(folder)

    def update_history_view(self):
        try:
            self.history_table.setRowCount(0)
            self.cursor.execute('SELECT DISTINCT user, path FROM downloads WHERE status="active"')
            galleries = set()
            for user, path in self.cursor.fetchall():
                album = os.path.basename(os.path.dirname(path)) if self.subfolder_check.isChecked() else os.path.basename(path)
                galleries.add(f"{user} - {album}")

            self.cursor.execute('SELECT COUNT(*) FROM downloads')
            total_rows = len(galleries) + self.cursor.fetchone()[0]
            self.history_table.setRowCount(total_rows)
            row = 0
            for gallery in sorted(galleries):
                self.history_table.setItem(row, 0, QTableWidgetItem(gallery))
                row += 1

            self.cursor.execute('SELECT filename, user, url, download_date, path, status FROM downloads')
            for record in self.cursor.fetchall():
                for col, value in enumerate(record):
                    self.history_table.setItem(row, col, QTableWidgetItem(str(value)))
                row += 1
            self.history_table.resizeColumnsToContents()
        except sqlite3.Error as e:
            self.result_list.addItem(f"Erro ao atualizar histórico: {e}")

    def download_images(self, force_user_folder=False, force_subfolder=False, force_overwrite=False):
        folder = self.folder_input.text()
        if not folder:
            self.result_list.addItem("Selecione uma pasta de destino!")
            return
        if not self.image_urls:
            self.result_list.addItem("Nenhuma imagem para baixar!")
            return

        # Processar imagens por URL da galeria
        for gallery_url in getattr(self, 'image_urls_dict', {}):
            user_name = self.users.get(gallery_url, "unknown_user")
            page_title = self.titles.get(gallery_url, f"album_{datetime.now().strftime('%Y%m%d_%H%M%S')}")

            dest_folder = folder
            if force_user_folder or self.user_folder_check.isChecked():
                try:
                    dest_folder = os.path.join(folder, user_name)
                    os.makedirs(dest_folder, exist_ok=True)
                    self.result_list.addItem(f"Pasta de usuário criada: {dest_folder}")
                except Exception as e:
                    self.result_list.addItem(f"Erro ao criar pasta de usuário '{user_name}': {e}. Usando pasta raiz.")
                    dest_folder = folder

            if force_subfolder or self.subfolder_check.isChecked():
                try:
                    dest_folder = os.path.join(dest_folder, page_title)
                    os.makedirs(dest_folder, exist_ok=True)
                    self.result_list.addItem(f"Subpasta criada: {dest_folder}")
                except Exception as e:
                    self.result_list.addItem(f"Erro ao criar subpasta '{page_title}': {e}. Usando pasta anterior.")

            self.result_list.addItem(f"Estrutura criada para {gallery_url}: {dest_folder}")

            # Verificar duplicatas na thread principal
            urls_to_download = []
            skip_messages = []
            try:
                for url in self.image_urls_dict.get(gallery_url, []):
                    url_hash = hashlib.md5(url.encode()).hexdigest()
                    if not (force_overwrite or self.overwrite_check.isChecked()) and (
                        url_hash in self.downloaded_urls_set or
                        (self.redis_client and self.redis_client.sismember('downloaded_urls', url_hash))
                    ):
                        self.cursor.execute('SELECT download_date FROM downloads WHERE url_hash=?', (url_hash,))
                        date = self.cursor.fetchone()
                        skip_messages.append(f"Imagem pulada: {url} (já baixada em {date[0] if date else 'desconhecido'})")
                    else:
                        urls_to_download.append(url)
            except sqlite3.Error as e:
                self.result_list.addItem(f"Erro ao verificar duplicatas para {gallery_url}: {e}")
                continue

            def download_single_image(url):
                try:
                    filename = os.path.join(dest_folder, url.split('/')[-1])
                    urllib.request.urlretrieve(url, filename)
                    return url, filename, f"Baixado: {filename}"
                except Exception as e:
                    return url, None, f"Erro ao baixar {url}: {e}"

            # Executar downloads
            max_workers = self.conn_input.value()
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                results = list(executor.map(download_single_image, urls_to_download))

            # Exibir mensagens de skip
            for message in skip_messages:
                self.result_list.addItem(message)

            # Processar resultados na thread principal
            try:
                for url, filename, message in results:
                    self.result_list.addItem(message)
                    if filename:
                        url_hash = hashlib.md5(url.encode()).hexdigest()
                        self.cursor.execute('''
                            INSERT OR REPLACE INTO downloads (filename, user, url, url_hash, download_date, path, status)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        ''', (os.path.basename(filename), user_name, url, url_hash, 
                              datetime.now().strftime('%Y-%m-%d %H:%M:%S'), filename, 'active'))
                        self.conn.commit()
                        if self.redis_client:
                            self.redis_client.sadd('downloaded_urls', url_hash)
                        self.downloaded_urls_set.add(url_hash)
            except sqlite3.Error as e:
                self.result_list.addItem(f"Erro ao registrar downloads para {gallery_url}: {e}")

        self.update_history_view()
        self.sync_folders()

    def one_click(self):
        self.result_list.clear()
        self.image_urls = []
        urls_input = self.url_input.text().strip()
        if not urls_input:
            self.result_list.addItem("Digite pelo menos uma URL válida!")
            return
        if not self.folder_input.text():
            self.result_list.addItem("Selecione uma pasta de destino!")
            return

        self.search_btn.setEnabled(False)
        self.one_click_btn.setEnabled(False)
        self.result_list.addItem("Iniciando One Click: busca e download (.webp, .gif)...")
        self.sync_folders()

        # Separar URLs por vírgula
        urls = [url.strip() for url in urls_input.split(',') if url.strip()]
        if not urls:
            self.result_list.addItem("Nenhuma URL válida fornecida!")
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)
            return

        # Processar cada URL
        for url in urls:
            self.result_list.addItem(f"Processando galeria: {url}")
            thread = ScraperThread(url, self.size_input.value())
            thread.result_signal.connect(lambda image_urls, u=url: self.one_click_download(image_urls, u))
            thread.error_signal.connect(self.display_error)
            thread.title_signal.connect(lambda title, u=url: self.set_page_title(title, u))
            thread.user_signal.connect(lambda user, u=url: self.set_user_name(user, u))
            thread.progress_signal.connect(self.result_list.addItem)
            thread.finished.connect(self.search_finished)
            thread.start()
            # Armazenar thread para evitar garbage collection
            if not hasattr(self, 'threads'):
                self.threads = []
            self.threads.append(thread)

    def one_click_download(self, image_urls, url):
        self.display_results(image_urls, url)
        if self.image_urls_dict.get(url):
            self.download_images(force_user_folder=True, force_subfolder=True, force_overwrite=True)
        self.search_finished()

if __name__ == '__main__':
    app = QApplication(sys.argv)
    window = ImageScraper()
    window.show()
    sys.exit(app.exec_())