-- Create builds table
CREATE TABLE IF NOT EXISTS builds (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  build_number INTEGER NOT NULL,
  build_type VARCHAR(50) NOT NULL, -- 'development', 'production', 'debug'
  target_platform VARCHAR(50) NOT NULL, -- 'web', 'desktop', 'mobile'
  status VARCHAR(50) NOT NULL, -- 'queued', 'building', 'completed', 'failed'
  build_path TEXT, -- Path to the build output
  logs TEXT, -- Build logs
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_builds_project_id ON builds(project_id);
CREATE INDEX idx_builds_created_by ON builds(created_by);
CREATE INDEX idx_builds_created_at ON builds(created_at);
CREATE INDEX idx_builds_status ON builds(status);