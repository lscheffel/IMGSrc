import sys
import requests
from bs4 import BeautifulSoup
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
                             QLineEdit, QPushButton, QListWidget, QFileDialog, QSpinBox, QLabel, QCheckBox)
from PyQt5.QtCore import Qt, QThread, pyqtSignal
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import re
from datetime import datetime

class ScraperThread(QThread):
    result_signal = pyqtSignal(list)
    error_signal = pyqtSignal(str)
    title_signal = pyqtSignal(str)
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

            response = session.get(self.url, timeout=5)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')

            # Extrair título
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
            page_links = soup.find_all('a', href=re.compile(r'tape-.*\.html\?pwd=$'))
            page_urls = [self.url]
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
                        if not img_url.lower().endswith('.webp'):
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
        self.setGeometry(100, 100, 600, 400)
        self.image_urls = []
        self.page_title = "album"
        self.init_ui()

    def init_ui(self):
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QVBoxLayout(main_widget)

        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("Digite a URL do tape (ex.: https://imgsrc.ru/.../tape-....html)")
        layout.addWidget(self.url_input)

        size_layout = QHBoxLayout()
        size_layout.addWidget(QLabel("Tamanho mínimo (KB):"))
        self.size_input = QSpinBox()
        self.size_input.setValue(10)
        self.size_input.setRange(1, 10000)
        size_layout.addWidget(self.size_input)
        layout.addLayout(size_layout)

        conn_layout = QHBoxLayout()
        conn_layout.addWidget(QLabel("Conexões simultâneas:"))
        self.conn_input = QSpinBox()
        self.conn_input.setValue(5)
        self.conn_input.setRange(1, 20)
        conn_layout.addWidget(self.conn_input)
        layout.addLayout(conn_layout)

        self.subfolder_check = QCheckBox("Criar subpasta com título do álbum")
        self.subfolder_check.setChecked(True)
        layout.addWidget(self.subfolder_check)

        self.search_btn = QPushButton("Search")
        self.search_btn.clicked.connect(self.search_images)
        layout.addWidget(self.search_btn)

        self.result_list = QListWidget()
        layout.addWidget(self.result_list)

        folder_layout = QHBoxLayout()
        self.folder_input = QLineEdit()
        self.folder_input.setPlaceholderText("Selecione a pasta de destino")
        folder_layout.addWidget(self.folder_input)
        self.folder_btn = QPushButton("Browse")
        self.folder_btn.clicked.connect(self.select_folder)
        folder_layout.addWidget(self.folder_btn)
        layout.addLayout(folder_layout)

        self.download_btn = QPushButton("Download")
        self.download_btn.clicked.connect(self.download_images)
        layout.addWidget(self.download_btn)

    def search_images(self):
        self.result_list.clear()
        self.image_urls = []
        url = self.url_input.text()
        if not url:
            self.result_list.addItem("Digite uma URL válida!")
            return

        self.search_btn.setEnabled(False)
        self.result_list.addItem("Iniciando busca de imagens (.webp)...")

        self.thread = ScraperThread(url, self.size_input.value())
        self.thread.result_signal.connect(self.display_results)
        self.thread.error_signal.connect(self.display_error)
        self.thread.title_signal.connect(self.set_page_title)
        self.thread.progress_signal.connect(self.result_list.addItem)
        self.thread.finished.connect(self.search_finished)
        self.thread.start()

    def set_page_title(self, title):
        self.page_title = title

    def display_results(self, image_urls):
        self.image_urls = [url for url, _ in image_urls]
        for url, size in image_urls:
            self.result_list.addItem(f"{url} ({size // 1024} KB)")

    def display_error(self, error_msg):
        self.result_list.addItem(error_msg)

    def search_finished(self):
        self.search_btn.setEnabled(True)
        if not self.image_urls:
            self.result_list.addItem("Nenhuma imagem .webp encontrada!")

    def select_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Selecione a pasta de destino")
        if folder:
            self.folder_input.setText(folder)

    def download_images(self):
        folder = self.folder_input.text()
        if not folder:
            self.result_list.addItem("Selecione uma pasta de destino!")
            return
        if not self.image_urls:
            self.result_list.addItem("Nenhuma imagem para baixar!")
            return

        dest_folder = folder
        if self.subfolder_check.isChecked():
            try:
                dest_folder = os.path.join(folder, self.page_title)
                os.makedirs(dest_folder, exist_ok=True)
                self.result_list.addItem(f"Subpasta criada: {dest_folder}")
            except Exception as e:
                self.result_list.addItem(f"Erro ao criar subpasta '{self.page_title}': {e}. Usando pasta raiz.")
                dest_folder = folder

        def download_single_image(url):
            try:
                filename = os.path.join(dest_folder, url.split('/')[-1])
                urllib.request.urlretrieve(url, filename)
                return f"Baixado: {filename}"
            except Exception as e:
                return f"Erro ao baixar {url}: {e}"

        max_workers = self.conn_input.value()
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            results = executor.map(download_single_image, self.image_urls)
            for result in results:
                self.result_list.addItem(result)

if __name__ == '__main__':
    app = QApplication(sys.argv)
    window = ImageScraper()
    window.show()
    sys.exit(app.exec_())