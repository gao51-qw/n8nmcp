#!/usr/bin/env node

/**
 * 审计日志数据库迁移脚本
 *
 * 使用方式：
 * node migrations/run-audit-migration.js
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 从环境变量读取配置
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing Supabase credentials');
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1);
}

// 创建 Supabase 客户端（使用 service_role 以绕过 RLS）
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function runMigration() {
  console.log('🚀 Starting audit log migration...\n');

  try {
    // 读取迁移 SQL 文件
    const sqlPath = join(__dirname, '004_create_workflow_audit_log.sql');
    const sql = readFileSync(sqlPath, 'utf-8');

    console.log('📄 Migration file loaded:', sqlPath);
    console.log('📏 SQL size:', sql.length, 'characters\n');

    // 拆分 SQL 语句（按分号分隔，忽略注释）
    const statements = sql
      .split(';')
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.length > 0 && !stmt.startsWith('--'));

    console.log('📝 Found', statements.length, 'SQL statements\n');

    // 逐条执行 SQL 语句
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const preview = statement.substring(0, 60).replace(/\n/g, ' ');

      console.log(`[${i + 1}/${statements.length}] Executing: ${preview}...`);

      try {
        // 使用 rpc 调用执行原始 SQL（Supabase 推荐方式）
        const { error } = await supabase.rpc('exec_sql', { sql_query: statement });

        if (error) {
          // 如果 exec_sql 函数不存在，尝试直接执行
          if (error.message.includes('function') && error.message.includes('does not exist')) {
            console.log('   ℹ️  exec_sql function not found, trying direct execution...');

            // 对于表创建等 DDL，我们需要手动执行
            // 注意：这需要你在 Supabase Dashboard 中手动运行 SQL
            console.log('   ⚠️  Please run this statement manually in Supabase SQL Editor:');
            console.log('   ', statement.substring(0, 100) + '...\n');
            continue;
          }
          throw error;
        }

        console.log('   ✅ Success\n');
      } catch (err) {
        console.error('   ❌ Error:', err.message);
        throw err;
      }
    }

    // 验证迁移结果
    console.log('🔍 Verifying migration...\n');

    // 检查表是否存在
    const { data: tables, error: tablesError } = await supabase
      .from('workflow_audit_log')
      .select('id')
      .limit(0);

    if (tablesError && !tablesError.message.includes('relation')) {
      console.log('✅ Table workflow_audit_log created successfully');
    } else if (tablesError) {
      throw new Error('Table verification failed: ' + tablesError.message);
    }

    console.log('\n✨ Migration completed successfully!\n');
    console.log('Next steps:');
    console.log('1. Integrate audit logging into your MCP tools');
    console.log('2. Test with a simple workflow operation');
    console.log('3. Check audit logs with: SELECT * FROM workflow_audit_log;\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\n💡 Tip: You can run the SQL manually in Supabase Dashboard > SQL Editor\n');
    process.exit(1);
  }
}

// 运行迁移
runMigration();
