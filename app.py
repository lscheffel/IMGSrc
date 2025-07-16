import sys
import requests
from bs4 import BeautifulSoup
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
                             QLineEdit, QPushButton, QListWidget, QFileDialog, QSpinBox, QLabel, QCheckBox,
                             QTabWidget, QMessageBox)
from PyQt5.QtCore import Qt, QThread, pyqtSignal
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import re
from datetime import datetime
import sqlite3
import redis
import hashlib
import logging
import time
import concurrent.futures
import unicodedata
from history import HistoryTab
from preview import PreviewTab

# Configurar logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

class ScraperThread(QThread):
    result_signal = pyqtSignal(list, int, int)
    error_signal = pyqtSignal(str)
    title_signal = pyqtSignal(str)
    user_signal = pyqtSignal(str)
    progress_signal = pyqtSignal(str)

    def __init__(self, url, min_size, max_scrape_threads):
        super().__init__()
        self.url = url
        self.min_size = min_size * 1024
        self.max_scrape_threads = max_scrape_threads

    def run(self):
        try:
            session = requests.Session()
            session.headers.update({'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'})
            image_urls = []
            total_images = 0
            discarded_images = 0

            logging.debug(f"Acessando URL da galeria: {self.url}")
            response = session.get(self.url, timeout=10)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            logging.debug("HTML da galeria parsed")

            tape_link = soup.find('a', href=re.compile(r'/[^/]+/tape-\d+-\d+-\d+\.html\?pwd='))
            logging.debug(f"Tape link encontrado: {tape_link}")
            if not tape_link:
                self.error_signal.emit("Link do tape não encontrado.")
                return
            tape_url = tape_link['href']
            tape_url = f"https://imgsrc.ru{tape_url}" if tape_url.startswith('/') else tape_url
            self.progress_signal.emit(f"Link do tape: {tape_url}")

            logging.debug(f"Acessando URL do tape: {tape_url}")
            response = session.get(tape_url, timeout=10)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            logging.debug("HTML do tape parsed")

            user_match = re.match(r'https://imgsrc\.ru/([^/]+)/', tape_url)
            user_name = user_match.group(1) if user_match else "unknown_user"
            self.user_signal.emit(user_name)

            title_tag = soup.find('title')
            page_title = title_tag.text.split(' @')[0] if title_tag else ""
            page_title = re.sub(r'[^\w\s-]', '', page_title).strip()
            page_title = re.sub(r'\s+', '_', page_title).rstrip('_') or f"album_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            # Sanitizar nome da pasta para evitar caracteres especiais
            page_title = unicodedata.normalize('NFKD', page_title).encode('ascii', 'ignore').decode('ascii')
            self.title_signal.emit(page_title)
            self.progress_signal.emit(f"Título da subpasta: {page_title}")

            page_urls = [tape_url]
            for link in soup.find_all('a', href=re.compile(r'tape-.*\.html\?pwd=$')):
                page_url = link['href']
                page_url = f"https://imgsrc.ru{page_url}" if page_url.startswith('/') else page_url
                if page_url not in page_urls:
                    page_urls.append(page_url)

            def scrape_page(current_url, page_index):
                page_images = []
                page_total_images = 0
                page_discarded_images = 0
                retries = 3
                while retries > 0:
                    self.progress_signal.emit(f"Buscando página {page_index} ({current_url})...")
                    logging.debug(f"Processando página: {current_url} (tentativa {4 - retries})")
                    try:
                        response = session.get(current_url, timeout=10)
                        response.raise_for_status()
                        soup = BeautifulSoup(response.text, 'html.parser')

                        for tag in soup.find_all(['source', 'img'], srcset=True) + soup.find_all('img', src=True):
                            img_url = tag.get('srcset') or tag.get('src')
                            if not img_url:
                                continue
                            if '/images/1.gif' in img_url:
                                logging.debug(f"URL descartado (irrelevante): {img_url}")
                                continue
                            if not img_url.lower().endswith(('.webp', '.gif', '.jpg', '.png')):
                                logging.debug(f"URL descartado (formato inválido): {img_url}")
                                continue
                            page_total_images += 1
                            if img_url.lower().endswith(('.jpg', '.png')):
                                page_discarded_images += 1
                                logging.debug(f"URL descartado (miniatura .jpg/.png): {img_url}")
                                continue
                            if img_url.startswith('//'):
                                img_url = f"https:{img_url}"
                            elif not img_url.startswith('http'):
                                img_url = f"https://imgsrc.ru{img_url}"
                            try:
                                img_response = session.get(img_url, allow_redirects=True, timeout=5)
                                if img_response.status_code != 200:
                                    logging.debug(f"URL com erro {img_response.status_code}: {img_url}")
                                    page_discarded_images += 1
                                    continue
                                size = int(img_response.headers.get('content-length', 0))
                                if size >= self.min_size:
                                    page_images.append((img_url, size))
                                    logging.debug(f"Imagem válida encontrada: {img_url} ({size // 1024} KB)")
                                else:
                                    logging.debug(f"Imagem descartada (tamanho pequeno): {img_url} ({size // 1024} KB)")
                                    page_discarded_images += 1
                            except requests.RequestException as e:
                                logging.warning(f"Erro ao verificar imagem {img_url}: {e}")
                                page_discarded_images += 1
                                continue
                        self.progress_signal.emit(f"Foram encontradas: {len(page_images)} imagens válidas (.webp/.gif), {page_discarded_images} descartadas (.jpg/.png ou inválidas), do total de {page_total_images} presentes na página")
                        return page_images, page_total_images, page_discarded_images
                    except requests.RequestException as e:
                        logging.error(f"Erro na página {current_url}: {e}")
                        self.progress_signal.emit(f"Erro na página {page_index}, tentando novamente ({retries} tentativas restantes)...")
                        retries -= 1
                        time.sleep(5)
                        if retries == 0:
                            self.progress_signal.emit(f"Erro na página {page_index}, continuando...")
                            return [], page_total_images, page_discarded_images
                return [], page_total_images, page_discarded_images

            with ThreadPoolExecutor(max_workers=self.max_scrape_threads) as executor:
                futures = [executor.submit(scrape_page, url, i) for i, url in enumerate(page_urls, 1)]
                for future in concurrent.futures.as_completed(futures):
                    page_images, page_total, page_discarded = future.result()
                    image_urls.extend(page_images)
                    total_images += page_total
                    discarded_images += page_discarded

            logging.debug(f"Total de imagens válidas encontradas: {len(image_urls)}")
            self.result_signal.emit(image_urls, total_images, discarded_images)
        except requests.RequestException as e:
            logging.error(f"Erro geral: {e}")
            self.error_signal.emit(f"Erro ao acessar URL: {e}")
        except Exception as e:
            logging.error(f"Erro inesperado: {e}")
            self.error_signal.emit(f"Erro inesperado: {e}")

class DownloadThread(QThread):
    progress_signal = pyqtSignal(str)
    finished_signal = pyqtSignal(int, float, int, int)

    def __init__(self, image_urls, dest_folder, user_name, downloaded_urls_set, redis_client, conn, cursor, max_workers, overwrite):
        super().__init__()
        self.image_urls = image_urls
        self.dest_folder = dest_folder
        self.user_name = user_name
        self.downloaded_urls_set = downloaded_urls_set
        self.redis_client = redis_client
        self.conn = conn
        self.cursor = cursor
        self.max_workers = max_workers
        self.overwrite = overwrite

    def run(self):
        try:
            logging.debug(f"Iniciando DownloadThread com {len(self.image_urls)} URLs para {self.dest_folder}")
            urls_to_download = []
            skip_messages = []
            total_bytes = 0
            total_downloads = 0
            total_errors = 0

            # Verificar permissões de escrita no diretório
            if not os.access(self.dest_folder, os.W_OK):
                self.progress_signal.emit(f"Erro: Sem permissão de escrita em {self.dest_folder}")
                self.finished_signal.emit(0, 0.0, 0, 1)
                return

            for url in self.image_urls:
                try:
                    url_hash = hashlib.md5(url.encode()).hexdigest()
                    if not self.overwrite and (
                        url_hash in self.downloaded_urls_set or
                        (self.redis_client and self.redis_client.sismember('downloaded_urls', url_hash))
                    ):
                        self.cursor.execute('SELECT download_date FROM downloads WHERE url_hash=?', (url_hash,))
                        date = self.cursor.fetchone()
                        skip_messages.append(f"Imagem pulada: {url} (já baixada em {date[0] if date else 'desconhecido'})")
                    else:
                        urls_to_download.append(url)
                except sqlite3.Error as e:
                    logging.error(f"Erro ao verificar duplicata para {url}: {e}")
                    self.progress_signal.emit(f"Erro ao verificar duplicata para {url}: {e}")
                    total_errors += 1
                    continue

            logging.debug(f"URLs para download: {len(urls_to_download)}")

            def download_single_image(url):
                try:
                    filename = os.path.join(self.dest_folder, url.split('/')[-1])
                    logging.debug(f"Tentando baixar: {url} para {filename}")
                    # Verificar se o arquivo já existe
                    if os.path.exists(filename) and not self.overwrite:
                        return url, None, 0, f"Imagem pulada: {filename} (já existe)"
                    # Abrir conexão com timeout
                    with urllib.request.urlopen(url, timeout=10) as response:
                        size = int(response.getheader('Content-Length', 0))
                        # Verificar se o diretório é gravável
                        with open(filename, 'wb') as f:
                            f.write(response.read())
                        logging.debug(f"Download concluído: {filename} ({size // 1024} KB)")
                        return url, filename, size, f"Baixado: {filename}"
                except urllib.error.URLError as e:
                    logging.error(f"Erro de URL ao baixar {url}: {e}")
                    return url, None, 0, f"Erro ao baixar {url}: {e}"
                except IOError as e:
                    logging.error(f"Erro de E/S ao baixar {url}: {e}")
                    return url, None, 0, f"Erro ao baixar {url}: {e}"
                except Exception as e:
                    logging.error(f"Erro inesperado ao baixar {url}: {e}")
                    return url, None, 0, f"Erro ao baixar {url}: {e}"

            try:
                # Usar max_workers=1 temporariamente para isolar problemas de concorrência
                with ThreadPoolExecutor(max_workers=1) as executor:
                    futures = [executor.submit(download_single_image, url) for url in urls_to_download]
                    for future in concurrent.futures.as_completed(futures):
                        try:
                            url, filename, size, message = future.result()
                            self.progress_signal.emit(message)
                            if filename:
                                total_downloads += 1
                                total_bytes += size
                                try:
                                    url_hash = hashlib.md5(url.encode()).hexdigest()
                                    self.cursor.execute('''
                                        INSERT OR REPLACE INTO downloads (filename, user, url, url_hash, download_date, path, status)
                                        VALUES (?, ?, ?, ?, ?, ?, ?)
                                    ''', (os.path.basename(filename), self.user_name, url, url_hash,
                                          datetime.now().strftime('%Y-%m-%d %H:%M:%S'), filename, 'active'))
                                    self.conn.commit()
                                    if self.redis_client:
                                        self.redis_client.sadd('downloaded_urls', url_hash)
                                    self.downloaded_urls_set.add(url_hash)
                                except sqlite3.Error as e:
                                    self.progress_signal.emit(f"Erro ao registrar download {url}: {e}")
                                    logging.error(f"Erro ao registrar download {url}: {e}")
                                    total_errors += 1
                            else:
                                total_errors += 1
                        except Exception as e:
                            logging.error(f"Erro ao processar resultado de download: {e}")
                            self.progress_signal.emit(f"Erro ao processar download: {e}")
                            total_errors += 1
            except Exception as e:
                logging.error(f"Erro no ThreadPoolExecutor: {e}")
                self.progress_signal.emit(f"Erro no processo de download: {e}")
                total_errors += 1

            for message in skip_messages:
                self.progress_signal.emit(message)

            logging.debug(f"DownloadThread concluído: {total_downloads} downloads, {total_bytes / (1024 * 1024):.2f} MB, {len(skip_messages)} pulados, {total_errors} erros")
            self.finished_signal.emit(total_downloads, total_bytes / (1024 * 1024), len(skip_messages), total_errors)
        except Exception as e:
            logging.error(f"Erro geral no DownloadThread: {e}")
            self.progress_signal.emit(f"Erro geral no download: {e}")
            self.finished_signal.emit(0, 0.0, len(skip_messages), total_errors + 1)

class ImageScraper(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Image Scraper")
        self.setGeometry(100, 100, 800, 500)
        self.image_urls = []
        self.page_title = "album"
        self.user_name = "unknown_user"
        self.downloaded_urls_set = set()
        self.scraper_thread = None
        self.download_thread = None
        self.init_db()
        self.init_redis()
        self.load_cache()
        self.init_ui()

    def init_db(self):
        try:
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
        except sqlite3.Error as e:
            logging.error(f"Erro ao inicializar banco de dados: {e}")

    def init_redis(self):
        try:
            self.redis_client = redis.Redis(host='localhost', port=6379, db=0)
            self.redis_client.ping()
        except redis.ConnectionError:
            self.redis_client = None
            logging.warning("Redis não disponível, usando apenas SQLite.")

    def load_cache(self):
        try:
            self.cursor.execute('SELECT url_hash FROM downloads WHERE status="active"')
            self.downloaded_urls_set = {row[0] for row in self.cursor.fetchall()}
        except sqlite3.Error as e:
            logging.error(f"Erro ao carregar cache: {e}")

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
            self.result_list.scrollToBottom()

    def init_ui(self):
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QVBoxLayout(main_widget)

        self.tabs = QTabWidget()
        layout.addWidget(self.tabs)

        main_tab = QWidget()
        main_layout = QVBoxLayout(main_tab)

        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("Digite a URL da galeria (ex.: https://imgsrc.ru/.../84647553.html)")
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

        scrape_threads_layout = QHBoxLayout()
        scrape_threads_layout.addWidget(QLabel("Threads de scraping:"))
        self.scrape_threads_input = QSpinBox()
        self.scrape_threads_input.setValue(6)
        self.scrape_threads_input.setRange(1, 20)
        scrape_threads_layout.addWidget(self.scrape_threads_input)
        main_layout.addLayout(scrape_threads_layout)

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

        self.history_tab = HistoryTab(self.conn, self.cursor, self.redis_client, self.result_list)
        self.tabs.addTab(self.history_tab.widget, "Histórico de Downloads")

        self.preview_tab = PreviewTab(self.result_list)
        self.tabs.addTab(self.preview_tab.widget, "Preview")

        self.history_tab.update_history_view()

    def search_images(self):
        if self.scraper_thread and self.scraper_thread.isRunning():
            self.result_list.addItem("Aguarde a busca atual concluir!")
            self.result_list.scrollToBottom()
            return

        self.result_list.clear()
        self.preview_tab.clear()
        self.image_urls = []
        url = self.url_input.text()
        if not url:
            self.result_list.addItem("Digite uma URL válida!")
            self.result_list.scrollToBottom()
            return

        self.search_btn.setEnabled(False)
        self.one_click_btn.setEnabled(False)
        self.download_btn.setEnabled(False)
        self.result_list.addItem("Iniciando busca de imagens (.webp, .gif)...")
        self.result_list.scrollToBottom()
        self.sync_folders()

        try:
            self.scraper_thread = ScraperThread(url, self.size_input.value(), self.scrape_threads_input.value())
            self.scraper_thread.result_signal.connect(self.display_results)
            self.scraper_thread.error_signal.connect(self.display_error)
            self.scraper_thread.title_signal.connect(self.set_page_title)
            self.scraper_thread.user_signal.connect(self.set_user_name)
            self.scraper_thread.progress_signal.connect(self.add_item_and_scroll)
            self.scraper_thread.finished.connect(self.search_finished)
            self.scraper_thread.start()
        except Exception as e:
            logging.error(f"Erro ao iniciar ScraperThread: {e}")
            self.result_list.addItem(f"Erro ao iniciar busca: {e}")
            self.result_list.scrollToBottom()
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)
            self.download_btn.setEnabled(True)

    def set_page_title(self, title):
        self.page_title = title

    def set_user_name(self, user):
        self.user_name = user

    def add_item_and_scroll(self, message):
        self.result_list.addItem(message)
        self.result_list.scrollToBottom()

    def display_results(self, image_urls, total_images, discarded_images):
        try:
            self.image_urls = [url for url, _ in image_urls]
            for url, size in image_urls:
                self.result_list.addItem(f"{url} ({size // 1024} KB)")
            self.preview_tab.display_images(image_urls)
            page_count = len(getattr(self.scraper_thread, 'page_urls', [1]))
            self.result_list.addItem(
                f"Busca concluída com sucesso!\n"
                f"Estatísticas: Usuário: {self.user_name}, Título: {self.page_title}, "
                f"Links tape: {page_count}, "
                f"Imagens válidas (.webp/.gif): {len(image_urls)}, "
                f"Imagens descartadas (.jpg/.png ou inválidas): {discarded_images}, "
                f"Total processado: {total_images}"
            )
            self.result_list.scrollToBottom()
        except Exception as e:
            logging.error(f"Erro em display_results: {e}")
            self.result_list.addItem(f"Erro ao exibir resultados: {e}")
            self.result_list.scrollToBottom()

    def display_error(self, error_msg):
        self.result_list.addItem(error_msg)
        self.result_list.scrollToBottom()

    def search_finished(self):
        self.search_btn.setEnabled(True)
        self.one_click_btn.setEnabled(True)
        self.download_btn.setEnabled(True)
        if not self.image_urls:
            self.result_list.addItem("Nenhuma imagem .webp ou .gif encontrada!")
            self.result_list.scrollToBottom()
        self.scraper_thread = None

    def select_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Selecione a pasta de destino")
        if folder:
            self.folder_input.setText(folder)

    def download_images(self, force_user_folder=False, force_subfolder=False, force_overwrite=False):
        try:
            folder = self.folder_input.text()
            if not folder:
                self.result_list.addItem("Selecione uma pasta de destino!")
                self.result_list.scrollToBottom()
                return
            if not self.image_urls:
                self.result_list.addItem("Nenhuma imagem para baixar!")
                self.result_list.scrollToBottom()
                return

            dest_folder = folder
            if force_user_folder or self.user_folder_check.isChecked():
                try:
                    dest_folder = os.path.join(folder, self.user_name)
                    os.makedirs(dest_folder, exist_ok=True)
                    self.result_list.addItem(f"Pasta de usuário criada: {dest_folder}")
                    self.result_list.scrollToBottom()
                except Exception as e:
                    self.result_list.addItem(f"Erro ao criar pasta de usuário '{self.user_name}': {e}")
                    self.result_list.scrollToBottom()
                    dest_folder = folder

            if force_subfolder or self.subfolder_check.isChecked():
                try:
                    dest_folder = os.path.join(dest_folder, self.page_title)
                    os.makedirs(dest_folder, exist_ok=True)
                    self.result_list.addItem(f"Subpasta criada: {dest_folder}")
                    self.result_list.scrollToBottom()
                except Exception as e:
                    self.result_list.addItem(f"Erro ao criar subpasta '{self.page_title}': {e}")
                    self.result_list.scrollToBottom()

            # Verificar permissões de escrita
            if not os.access(dest_folder, os.W_OK):
                self.result_list.addItem(f"Erro: Sem permissão de escrita em {dest_folder}")
                self.result_list.scrollToBottom()
                self.download_btn.setEnabled(True)
                return

            self.result_list.addItem(f"Estrutura criada: {dest_folder}")
            self.result_list.scrollToBottom()

            if self.download_thread and self.download_thread.isRunning():
                self.result_list.addItem("Aguarde o download atual concluir!")
                self.result_list.scrollToBottom()
                return

            logging.debug(f"Iniciando download com {len(self.image_urls)} URLs para {dest_folder}")
            self.download_btn.setEnabled(False)
            self.download_thread = DownloadThread(
                self.image_urls, dest_folder, self.user_name, self.downloaded_urls_set,
                self.redis_client, self.conn, self.cursor, 1, force_overwrite or self.overwrite_check.isChecked()
            )
            self.download_thread.progress_signal.connect(self.add_item_and_scroll)
            self.download_thread.finished_signal.connect(self.download_finished)
            self.download_thread.start()
        except Exception as e:
            logging.error(f"Erro em download_images: {e}")
            self.result_list.addItem(f"Erro ao iniciar download: {e}")
            self.result_list.scrollToBottom()
            self.download_btn.setEnabled(True)
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)

    def download_finished(self, total_downloads, total_mb, skipped, errors):
        try:
            self.result_list.addItem(
                f"Download concluído com sucesso!\n"
                f"Estatísticas: Downloads concluídos: {total_downloads}, "
                f"Total baixado: {total_mb:.2f} MB, "
                f"Itens descartados (já baixados): {skipped}, "
                f"Erros: {errors}"
            )
            self.result_list.scrollToBottom()
            self.history_tab.update_history_view()
            self.sync_folders()
            self.download_btn.setEnabled(True)
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)
            self.download_thread = None
        except Exception as e:
            logging.error(f"Erro em download_finished: {e}")
            self.result_list.addItem(f"Erro ao finalizar download: {e}")
            self.result_list.scrollToBottom()
            self.download_btn.setEnabled(True)
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)

    def one_click(self):
        if self.scraper_thread and self.scraper_thread.isRunning():
            self.result_list.addItem("Aguarde a busca atual concluir!")
            self.result_list.scrollToBottom()
            return

        self.result_list.clear()
        self.preview_tab.clear()
        self.image_urls = []
        url = self.url_input.text()
        if not url:
            self.result_list.addItem("Digite uma URL válida!")
            self.result_list.scrollToBottom()
            return
        if not self.folder_input.text():
            self.result_list.addItem("Selecione uma pasta de destino!")
            self.result_list.scrollToBottom()
            return

        self.search_btn.setEnabled(False)
        self.one_click_btn.setEnabled(False)
        self.download_btn.setEnabled(False)
        self.result_list.addItem("Iniciando One Click: busca e download (.webp, .gif)...")
        self.result_list.scrollToBottom()
        self.sync_folders()

        try:
            logging.debug("Iniciando ScraperThread para One Click")
            self.scraper_thread = ScraperThread(url, self.size_input.value(), self.scrape_threads_input.value())
            self.scraper_thread.result_signal.connect(lambda image_urls, total, discarded: self.one_click_download(image_urls, total, discarded))
            self.scraper_thread.error_signal.connect(self.display_error)
            self.scraper_thread.title_signal.connect(self.set_page_title)
            self.scraper_thread.user_signal.connect(self.set_user_name)
            self.scraper_thread.progress_signal.connect(self.add_item_and_scroll)
            self.scraper_thread.finished.connect(self.search_finished)
            self.scraper_thread.start()
        except Exception as e:
            logging.error(f"Erro ao iniciar ScraperThread em one_click: {e}")
            self.result_list.addItem(f"Erro ao iniciar One Click: {e}")
            self.result_list.scrollToBottom()
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)
            self.download_btn.setEnabled(True)

    def one_click_download(self, image_urls, total_images, discarded_images):
        try:
            logging.debug(f"Iniciando one_click_download com {len(image_urls)} imagens")
            self.display_results(image_urls, total_images, discarded_images)
            if self.image_urls:
                logging.debug(f"Chamando download_images para One Click com {len(self.image_urls)} URLs")
                self.download_images(force_user_folder=True, force_subfolder=True, force_overwrite=True)
            else:
                self.result_list.addItem("Nenhuma imagem válida para download!")
                self.result_list.scrollToBottom()
            logging.debug("one_click_download concluído com sucesso")
        except Exception as e:
            logging.error(f"Erro em one_click_download: {e}")
            self.result_list.addItem(f"Erro ao finalizar One Click: {e}")
            self.result_list.scrollToBottom()
            self.search_btn.setEnabled(True)
            self.one_click_btn.setEnabled(True)
            self.download_btn.setEnabled(True)

if __name__ == '__main__':
    try:
        app = QApplication(sys.argv)
        window = ImageScraper()
        window.show()
        sys.exit(app.exec_())
    except Exception as e:
        logging.error(f"Erro fatal na inicialização do aplicativo: {e}")