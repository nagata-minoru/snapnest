import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { openLibraryStore } from './db/libraryStore'
import { createFileSystemAccessSource, type DirectoryPickerHost } from './fs/fileSystemAccess'
import './styles.css'

const source = createFileSystemAccessSource(window as DirectoryPickerHost)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App source={source} openStore={openLibraryStore} />
  </StrictMode>,
)
