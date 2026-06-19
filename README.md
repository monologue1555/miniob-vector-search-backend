# MiniOB 向量检索后端课程实现

[![build](https://github.com/FlowerNeverFade/miniob-vector-search-backend/actions/workflows/build-test.yml/badge.svg)](https://github.com/FlowerNeverFade/miniob-vector-search-backend/actions/workflows/build-test.yml)

本仓库是《数据库系统设计实践》课程项目的 MiniOB 后端实现，基于 OceanBase MiniOB `main` 分支扩展向量数据库内核能力。实现范围覆盖实验指导书中的四个任务：向量类型存储、向量距离计算、精确 Top-N 查询与排序、IVF_Flat 近似向量索引。

上游项目：<https://github.com/oceanbase/miniob>

课程实现基线：`oceanbase/miniob` main 分支 commit `9f856a542decb6dc678650406af7d6e351940dab`。

## 完成状态

| 任务 | 课程要求 | 当前实现 |
| --- | --- | --- |
| A1 向量类型数据存储 | `VECTOR(N)`、默认维度、最大维度、建表、插入、维度校验、比较规则 | 已完成 |
| A2 向量距离计算 | `STRING_TO_VECTOR`、`VECTOR_TO_STRING`、`DISTANCE`，支持欧氏距离、余弦距离、内积 | 已完成 |
| A3 精确查询与排序 | `SELECT ... AS`、`ORDER BY` 字段/函数/别名、升降序、距离排序 | 已完成 |
| A4 IVF_Flat 近似搜索 | `CREATE VECTOR INDEX`、`lists/probes`、K-Means、`LIMIT` Top-N、优化器下压 | 已完成 |

专项回归用例位于 `test/case/test/vector-search.test`，期望结果位于 `test/case/result/vector-search.result`。GitHub Actions 已将 `basic` 与 `vector-search` 一起纳入 `basic-test`，并保留 MiniOB 原有 build、CTest、integration、memtracer、benchmark、sysbench 验证矩阵。

## SQL 功能

### A1 向量存储

- 新增 SQL 类型 `VECTOR(N)`。
- `VECTOR` 不带括号时默认维度为 `2048`。
- 最大维度为 `16383`。
- `VECTOR()` 和 `VECTOR(16384)` 等非法定义会失败。
- 内部使用连续 `float` 二进制存储。
- 插入时校验字段类型与向量维度。
- `WHERE` 比较中只允许 `VECTOR = VECTOR`，拒绝 `VECTOR <> VECTOR`、大小比较和跨类型比较。

```sql
create table t_vec(id int, emb vector(3), tag char);
insert into t_vec values(1, string_to_vector('[1, 0, 0]'), 'a');
select id from t_vec where emb = string_to_vector('[1,0,0]');
```

### A2 距离计算

- `STRING_TO_VECTOR(string)`：解析 `[1, 2, -3.5]` 格式，支持空白、小数和负数。
- `VECTOR_TO_STRING(vector)`：输出标准向量字符串。
- `DISTANCE(vec1, vec2, method)`：支持 `EUCLIDEAN`、`COSINE`、`DOT`。
- 兼容 `L2_DISTANCE`、`COSINE_DISTANCE`、`INNER_PRODUCT`。
- 非法格式、未知距离方法、维度不一致、零向量余弦距离计算会返回错误。

```sql
select vector_to_string(string_to_vector('[-1.5, 0, 2.25]')) as v from t_vec limit 1;
select distance(string_to_vector('[1,2]'), string_to_vector('[4,6]'), euclidean) as l2 from t_vec limit 1;
select distance(string_to_vector('[1,0]'), string_to_vector('[0,1]'), cosine) as cos from t_vec limit 1;
select distance(string_to_vector('[1,2,3]'), string_to_vector('[4,5,6]'), 'INNER_PRODUCT') as dot from t_vec limit 1;
```

### A3 精确查询、别名、排序与 Limit

- 支持 `SELECT ... AS alias`。
- 支持 `ORDER BY expr|alias [ASC|DESC]`。
- 支持 `LIMIT N`。
- 函数表达式可用于 SELECT 列表和 ORDER BY。
- ORDER BY 可引用 SELECT 别名。
- 排序阶段支持普通标量、距离结果和向量字段的确定性比较。

```sql
select id, distance(emb, string_to_vector('[0,0,0]'), euclidean) as dis
from t_vec
order by dis asc
limit 2;

select id, distance(emb, string_to_vector('[1,0,0]'), 'DOT') as score
from t_vec
order by score desc
limit 2;
```

### A4 IVF_Flat 向量索引

- 支持默认向量索引创建：

```sql
create vector index idx_vec on t_vec(emb);
```

- 支持自定义参数：

```sql
create vector index idx_vec_custom on t_vec(emb)
with (distance=cosine, type=ivfflat, lists=2, probes=1);
```

- 默认参数为 `type=ivfflat`、`lists=245`、`probes=5`。
- 索引元数据记录 `is_vector`、`distance`、`type`、`lists`、`probes`，并参与 JSON 序列化。
- 创建索引时扫描已有记录并训练聚类。
- IVF_Flat 使用确定性 K-Means，固定初始化，最多 50 轮。
- 插入和删除记录时同步维护簇内 RID。
- 优化器识别 `ORDER BY DISTANCE(vector_col, constant_vector, method) LIMIT N`，存在匹配 IVF_Flat 索引时下压为 `VECTOR_INDEX_SCAN`。

```sql
explain select id, distance(emb, string_to_vector('[0,0,0]'), euclidean) as dis
from t_vec
order by distance(emb, string_to_vector('[0,0,0]'), euclidean) asc
limit 2;
```

执行计划中应出现 `VECTOR_INDEX_SCAN`。

## 关键代码位置

| 模块 | 文件 |
| --- | --- |
| 向量类型和值存储 | `src/observer/common/type/vector_type.*`, `src/observer/common/value.*` |
| 类型注册 | `src/observer/common/type/attr_type.*`, `src/observer/common/type/data_type.cpp` |
| SQL 词法/语法 | `src/observer/sql/parser/lex_sql.l`, `src/observer/sql/parser/yacc_sql.y` |
| 表达式与向量函数 | `src/observer/sql/expr/expression.*` |
| 表达式绑定与别名 | `src/observer/sql/parser/expression_binder.*` |
| Select 语句 | `src/observer/sql/stmt/select_stmt.*` |
| 创建索引语句 | `src/observer/sql/stmt/create_index_stmt.*` |
| 排序与 Limit 算子 | `src/observer/sql/operator/sort_*`, `src/observer/sql/operator/limit_*` |
| 向量索引扫描算子 | `src/observer/sql/operator/vector_index_*` |
| 逻辑/物理计划 | `src/observer/sql/optimizer/logical_plan_generator.cpp`, `src/observer/sql/optimizer/physical_plan_generator.cpp` |
| IVF_Flat 索引 | `src/observer/storage/index/ivfflat_index.*` |
| 索引元数据 | `src/observer/storage/index/index_meta.*` |
| 表与索引维护 | `src/observer/storage/table/table.*`, `src/observer/storage/table/heap_table_engine.*` |
| 向量回归测试 | `test/case/test/vector-search.test`, `test/case/result/vector-search.result` |

## 构建与运行

推荐使用课程资料包中的 WSL2 + Docker / `miniob-course` 环境，或者使用 GitHub Actions 中的 Ubuntu runner 环境。

初始化依赖：

```bash
sudo bash build.sh init
```

Debug 构建：

```bash
bash build.sh debug --make -j"$(nproc)"
```

Release 构建：

```bash
bash build.sh release --make -j"$(nproc)"
```

运行 observer (CLI 交互模式)：

```bash
cd build_debug
./bin/observer -f ../etc/observer.ini -P cli
```

---

## 运行向量可视化控制台 Web UI

本项目已集成极具美感的 Web 可视化控制台（包含 SQL 终端、向量数据渲染与 2D ECharts 可视化、高性能 K-NN 检索评测对比等）。控制台的运行由以下三个部分协同工作组成：

### 1. 启动 MiniOB Observer 数据库实例 (WSL2 / Docker)
需要使用 `plain` 文本协议模式启动 MiniOB 实例，以便与后端的 TCP 客户端通信：
```bash
cd build_debug
# 监听 6789 端口，并以 plain 协议启动
./bin/observer -f ../etc/observer.ini -p 6789 -P plain
```

### 2. 启动 Flask 网关后端 (WSL2 / Docker)
网关后端负责将前端发出的 HTTP 请求打包成 TCP 数据包与 MiniOB 通信：
1. 进入 backend 目录：
   ```bash
   cd backend
   ```
2. 安装依赖（主要为 `Flask` 与 `Flask-CORS`）：
   ```bash
   pip install flask flask-cors
   ```
3. 启动 Flask 后端：
   ```bash
   python app.py
   ```
   后端将在 `http://localhost:5000` 监听。

### 3. 启动 React Vite 前端控制台 (Windows 主机)
提供现代化的极简暗黑风可视化操作界面：
1. 进入 frontend 目录：
   ```bash
   cd frontend
   ```
2. 安装依赖：
   ```bash
   npm install
   ```
3. 启动开发服务器：
   ```bash
   npm run dev
   ```
4. 在浏览器中打开本地预览地址：
   `http://localhost:5173/`

### 4. 向量测试 SQL 参考
进入 Web 控制台后，您可以在 SQL Terminal 中执行以下语句来验证向量检索功能：
```sql
-- 创建 3 维向量表
create table t_vec(id int, emb vector(3), tag char);

-- 插入向量数据
insert into t_vec values(1, string_to_vector('[1.0, 0.0, 0.0]'), 'a');
insert into t_vec values(2, string_to_vector('[3.0, 0.0, 0.0]'), 'b');
insert into t_vec values(3, string_to_vector('[6.0, 0.0, 0.0]'), 'c');
insert into t_vec values(4, string_to_vector('[-2.0, 0.0, 0.0]'), 'd');

-- 创建 IVF_Flat 索引
create vector index idx_vec on t_vec(emb) with (distance=euclidean, type=ivfflat, lists=2, probes=1);

-- 向量检索并计算距离排序
select id, distance(emb, string_to_vector('[0,0,0]'), euclidean) as dis from t_vec order by dis asc limit 3;
```

## 测试与验收

运行课程专项 SQL 回归：

```bash
python3 test/case/miniob_test.py --test-cases=vector-search
```

运行基础 SQL 与向量专项回归：

```bash
python3 test/case/miniob_test.py --test-cases=basic,vector-search
```

GitHub Actions workflow：`.github/workflows/build-test.yml`

CI 覆盖：

- Ubuntu Debug build + CTest
- Ubuntu Release build
- macOS build
- `basic-test`，包含 `basic` 与 `vector-search`
- `integration-test`
- `memtracer-test`
- `benchmark-test`
- sysbench 矩阵

最新状态请以仓库顶部 badge 和 Actions 页面为准：<https://github.com/FlowerNeverFade/miniob-vector-search-backend/actions>

## 许可证

本项目继承 MiniOB 的 Mulan PSL v2 许可证。详见 [License](License)。
