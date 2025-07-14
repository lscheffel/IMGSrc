import sys
import requests
from bs4 import BeautifulSoup
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
                             QLineEdit, QPushButton, QListWidget, QFileDialog, QSpinBox, QLabel)
from PyQt5.QtCore import Qt
import os
import urllib.request

class ImageScraper(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Image Scraper")
        self.setGeometry(100, 100, 600, 400)
        self.init_ui()
        self.image_urls = []

    def init_ui(self):
        # Layout principal
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QVBoxLayout(main_widget)

        # Campo para URL
        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("Digite a URL (ex.: https://imgsrc.ru/.../tape-....html)")
        layout.addWidget(self.url_input)

        # Controle de tamanho mínimo
        size_layout = QHBoxLayout()
        size_layout.addWidget(QLabel("Tamanho mínimo (KB):"))
        self.size_input = QSpinBox()
        self.size_input.setValue(10)  # Valor padrão: 10 KB
        self.size_input.setRange(1, 10000)
        size_layout.addWidget(self.size_input)
        layout.addLayout(size_layout)

        # Botão de busca
        self.search_btn = QPushButton("Search")
        self.search_btn.clicked.connect(self.search_images)
        layout.addWidget(self.search_btn)

        # Lista de resultados
        self.result_list = QListWidget()
        layout.addWidget(self.result_list)

        # Seletor de pasta
        folder_layout = QHBoxLayout()
        self.folder_input = QLineEdit()
        self.folder_input.setPlaceholderText("Selecione a pasta de destino")
        folder_layout.addWidget(self.folder_input)
        self.folder_btn = QPushButton("Browse")
        self.folder_btn.clicked.connect(self.select_folder)
        folder_layout.addWidget(self.folder_btn)
        layout.addLayout(folder_layout)

        # Botão de download
        self.download_btn = QPushButton("Download")
        self.download_btn.clicked.connect(self.download_images)
        layout.addWidget(self.download_btn)

    def search_images(self):
        self.result_list.clear()
        self.image_urls = []
        url = self.url_input.text()
        min_size = self.size_input.value() * 1024  # Converter KB para bytes

        try:
            response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            img_tags = soup.find_all('img', src=True)

            for img in img_tags:
                img_url = img['src']
                if not img_url.startswith('http'):
                    img_url = f"https://imgsrc.ru{img_url}"
                try:
                    # Verificar tamanho da imagem
                    img_response = requests.head(img_url, allow_redirects=True)
                    size = int(img_response.headers.get('content-length', 0))
                    if size >= min_size:
                        self.image_urls.append(img_url)
                        self.result_list.addItem(f"{img_url} ({size // 1024} KB)")
                except requests.RequestException:
                    continue
        except requests.RequestException as e:
            self.result_list.addItem(f"Erro ao acessar URL: {e}")

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

        for url in self.image_urls:
            try:
                filename = os.path.join(folder, url.split('/')[-1])
                urllib.request.urlretrieve(url, filename)
                self.result_list.addItem(f"Baixado: {filename}")
            except Exception as e:
                self.result_list.addItem(f"Erro ao baixar {url}: {e}")

if __name__ == '__main__':
    app = QApplication(sys.argv)
    window = ImageScraper()
    window.show()
    sys.exit(app.exec_())